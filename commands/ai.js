const OpenAIUtils = require("../utils/openai");
const path = require("path");
const fs = require("fs-extra");
const sqlite3 = require('sqlite3').verbose();
const axios = require('axios');

const DB_PATH = path.join(__dirname, "..", "database", "conversation.db");
const USERS_PATH = path.join(__dirname, "..", "database", "users.json");
const CACHE_PATH = path.join(__dirname, "cache", "vision");

const openai = new OpenAIUtils();
const db = initDatabase();

function initDatabase() {
  const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.ensureDirSync(dir);
    }
    
  const database = new sqlite3.Database(DB_PATH);
  
  database.run(`CREATE TABLE IF NOT EXISTS conversations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    thread_id TEXT,
    sender_id TEXT,
    user_name TEXT,
    user_message TEXT,
    bot_response TEXT,
    timestamp INTEGER,
    UNIQUE(thread_id, sender_id, timestamp)
  )`);
  
  return database;
}

function getUserName(senderID) {
  try {
    if (fs.existsSync(USERS_PATH)) {
      const users = fs.readJsonSync(USERS_PATH);
      if (users[senderID] && users[senderID].name) {
        return users[senderID].name;
      }
    }
    return senderID.toString();
  } catch (error) {
    console.error('❌ Lỗi đọc users.json:', error.message);
    return senderID.toString();
  }
}

function getConversationHistory(threadID, senderID) {
  return new Promise((resolve, reject) => {
    const conversationKey = `${threadID}_${senderID}`;
    
    db.all(
      `SELECT * FROM conversations 
       WHERE thread_id = ? AND sender_id = ? 
       ORDER BY timestamp DESC LIMIT 500`,
      [threadID, senderID],
      (err, rows) => {
        if (err) {
          console.error(`❌ Lỗi đọc lịch sử cho ${conversationKey}:`, err.message);
          resolve([]);
        } else {
          console.log(`✅ Đã đọc ${rows.length} tin nhắn cho ${conversationKey}`);
          resolve(rows.map(row => ({
            timestamp: row.timestamp,
            userMessage: row.user_message,
            botResponse: row.bot_response,
            senderID: row.sender_id,
            userName: row.user_name
          })).reverse());
        }
      }
    );
  });
}

function updateHistory(threadID, userMessage, botResponse, senderID) {
  const userName = getUserName(senderID);
  const timestamp = Date.now();
  
  db.run(
    `INSERT INTO conversations (thread_id, sender_id, user_name, user_message, bot_response, timestamp)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [threadID, senderID, userName, userMessage, botResponse, timestamp]
  );
}

async function generateResponse(message, senderID, threadID) {
  try {
    const userName = getUserName(senderID);
    
    const history = await getConversationHistory(threadID, senderID);
    
    const formattedHistory = history.slice(-5).map(h => [
      { role: 'user', content: h.userMessage },
      { role: 'assistant', content: h.botResponse }
    ]).flat();
    
    const response = await openai.chat(message, {
      systemPrompt: openai.getSystemPrompt(userName),
      messages: [
        { role: 'system', content: openai.getSystemPrompt(userName) },
        ...formattedHistory,
        { role: 'user', content: message }
      ],
      temperature: 0.8,
      max_tokens: 2048
    });
    
    if (!response.success) {
      throw new Error(response.error || "Lỗi khi gọi OpenAI");
    }
    
    return response.content;
  } catch (error) {
    return "Ủa, có gì đó không ổn rồi. Thử nói lại xem nào!";
  }
}

async function downloadImage(url, filePath) {
  try {
    const response = await axios({
      method: 'GET',
      url: url,
      responseType: 'stream'
    });

    if (!fs.existsSync(path.dirname(filePath))) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    }

    const writer = fs.createWriteStream(filePath);
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => resolve(filePath));
      writer.on('error', reject);
    });
  } catch (error) {
    console.error('❌ Lỗi tải hình ảnh:', error.message);
    throw error;
  }
}

async function analyzeImage(imageUrl, prompt, senderID, threadID) {
  try {
    const userName = getUserName(senderID);
    const timestamp = Date.now();
    const fileName = `${senderID}_${timestamp}.jpg`;
    const imagePath = path.join(CACHE_PATH, fileName);
    
    await downloadImage(imageUrl, imagePath);
    
 
    const history = await getConversationHistory(threadID, senderID);
    
    let contextFromHistory = "";
    if (history.length > 0) {
      const recentHistory = history.slice(-3);
      contextFromHistory = recentHistory.map(h => 
        `${userName}: ${h.userMessage}\nNgân: ${h.botResponse}`
      ).join('\n\n');
    }
    
    const visionSystemPrompt = openai.getVisionSystemPrompt(userName, contextFromHistory);
    
    const defaultPrompt = prompt;
    
    const response = await openai.vision(imagePath, defaultPrompt, {
      temperature: 0.8,
      max_tokens: 2048,
      detail: 'high',
      visionSystemPrompt: visionSystemPrompt
    });
    
    if (!response.success) {
      throw new Error(response.error || "Lỗi khi gọi OpenAI Vision");
    }
    
    return response.content;
  } catch (error) {
    return "Xin lỗi, mình không thể phân tích hình ảnh này. Có thể do lỗi kết nối hoặc định dạng hình ảnh không được hỗ trợ.";
  }
}

function clearConversationHistory(threadID, senderID) {
  return new Promise((resolve, reject) => {
    db.run(
      `DELETE FROM conversations WHERE thread_id = ? AND sender_id = ?`,
      [threadID, senderID],
      function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.changes);
        }
      }
    );
  });
}

module.exports = {
  name: "bot",
  usedby: 0,
  dmUser: false,
  dev: "HNT",
  category: "AI", 
  nickName: ["bot", "simple"],
  info: "Simple chatbot with basic replies",
  onPrefix: false,
  cooldowns: 1,

  onReply: async function ({ event, api }) {
    const { threadID, messageID, body, senderID, attachments, messageReply } = event;
    
    try {
      const hasAttachmentImage = attachments && attachments.length > 0 && attachments.some(att => att.type === "photo");
      const hasReplyImage = messageReply && messageReply.attachments && 
                           messageReply.attachments.length > 0 && 
                           messageReply.attachments.some(att => att.type === "photo");
      
      if (hasAttachmentImage || hasReplyImage) {
        let imageUrl;
        if (hasAttachmentImage) {
          imageUrl = attachments.find(att => att.type === "photo").url;
        } else {
          imageUrl = messageReply.attachments.find(att => att.type === "photo").url;
        }
        
        const imagePrompt = body || "Mô tả chi tiết hình ảnh này";
        const response = await analyzeImage(imageUrl, imagePrompt, senderID, threadID);
        
        const userMessage = body ? `[Hình ảnh] ${body}` : "[Hình ảnh]";
        updateHistory(threadID, userMessage, response, senderID);
        
        const sent = await api.sendMessage(response, threadID, messageID);
        
        if (sent) {
          global.client.onReply.push({
            name: this.name,
            messageID: sent.messageID,
            author: senderID
          });
        }
        
        return;
      }
      
      if (!body) return;
    
      const response = await generateResponse(body, senderID, threadID);
      
      updateHistory(threadID, body, response, senderID);
      
      const sent = await api.sendMessage(response, threadID, messageID);
      
      if (sent) {
        global.client.onReply.push({
          name: this.name,
          messageID: sent.messageID,
          author: senderID
        });
      }
      
    } catch (error) {
      api.sendMessage("Có lỗi rồi, thử lại nhé!", threadID, messageID);
    }
  },

  onLaunch: async function ({ event, api, target }) {
    const { threadID, messageID, body, senderID, attachments, messageReply } = event;
    
    try {
      if (!body || !body.toLowerCase().trim().startsWith("bot")) {
        return;
      }

      if (target && target[0]?.toLowerCase() === "reset") {
        await clearConversationHistory(threadID, senderID);
        const userName = getUserName(senderID);
        return api.sendMessage(`Đã reset lịch sử chat cho ${userName}!`, threadID, messageID);
      }

      const hasAttachmentImage = attachments && attachments.length > 0 && attachments.some(att => att.type === "photo");
      const hasReplyImage = messageReply && messageReply.attachments && 
                           messageReply.attachments.length > 0 && 
                           messageReply.attachments.some(att => att.type === "photo");
      
      if (hasAttachmentImage || hasReplyImage) {
        let imageUrl;
        if (hasAttachmentImage) {
          imageUrl = attachments.find(att => att.type === "photo").url;
        } else {
          imageUrl = messageReply.attachments.find(att => att.type === "photo").url;
        }
        
        const imagePrompt = body.replace(/^bot\s*/i, "").trim() || "Mô tả chi tiết hình ảnh này";
        const response = await analyzeImage(imageUrl, imagePrompt, senderID, threadID);
        
        const userMessage = `[Hình ảnh] ${imagePrompt}`;
        updateHistory(threadID, userMessage, response, senderID);
        
        const sent = await api.sendMessage(response, threadID, messageID);
        
        if (sent) {
          global.client.onReply.push({
            name: this.name,
            messageID: sent.messageID,
            author: senderID
          });
        }
        
        return;
      }

      const response = await generateResponse(body, senderID, threadID);
        
        updateHistory(threadID, body, response, senderID);
        
        const sent = await api.sendMessage(response, threadID, messageID);
        
        if (sent) {
          global.client.onReply.push({
            name: this.name,
            messageID: sent.messageID,
            author: senderID
          });
      }
      
    } catch (error) {
      api.sendMessage("Lỗi rồi bạn ơi!", threadID, messageID);
    }
  },

  generateResponse,
  updateHistory,
  clearConversationHistory,
  getConversationHistory,
  analyzeImage
};