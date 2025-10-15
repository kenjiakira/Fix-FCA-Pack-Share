const chatbot = require("../commands/ai");

const TRIGGER_KEYWORDS = [
    "ngân", 
    "con ngân",
    "bot"
];

const containsTriggerWord = (text) => {
    if (!text) return false;
    text = text.toLowerCase();
    return TRIGGER_KEYWORDS.some(keyword => text.includes(keyword));
};

module.exports = {
    name: "ai",
    version: "1.0", 
    author: "HNT",
    onEvents: async function({ api, event }) {
        const { threadID, messageID, body, senderID, attachments, type, messageReply } = event;
        
        if (type !== "message") return;
        
        if (body && body.toLowerCase().trim().startsWith("bot")) return;
       
        const hasAttachmentImage = attachments && attachments.length > 0 && attachments.some(att => att.type === "photo");
        const hasReplyImage = messageReply && messageReply.attachments && 
                             messageReply.attachments.length > 0 && 
                             messageReply.attachments.some(att => att.type === "photo");
        
        const isReplyingToBot = messageReply && 
                               global.client.onReply.some(r => 
                                 r.messageID === messageReply.messageID && 
                                 r.name === "bot");
        
        if (isReplyingToBot) {
            try {
                if (hasAttachmentImage || hasReplyImage) {
                    let imageUrl;
                    if (hasAttachmentImage) {
                        imageUrl = attachments.find(att => att.type === "photo").url;
                    } else {
                        imageUrl = messageReply.attachments.find(att => att.type === "photo").url;
                    }
                    
                    const imagePrompt = body || "Mô tả chi tiết hình ảnh này";
                    const response = await chatbot.analyzeImage(imageUrl, imagePrompt, senderID, threadID);
                    
                    const userMessage = body ? `[Hình ảnh] ${body}` : "[Hình ảnh]";
                    chatbot.updateHistory(threadID, userMessage, response, senderID);
                    
                    const sent = await api.sendMessage(response, threadID, messageID);
                    
                    if (sent) {
                        global.client.onReply.push({
                            name: "bot",
                            messageID: sent.messageID,
                            author: senderID
                        });
                    }
                    
                    return;
                }
                
                if (body) {
                    const response = await chatbot.generateResponse(body, senderID, threadID);
                    
                    chatbot.updateHistory(threadID, body, response, senderID);
                    
                    const sent = await api.sendMessage(response, threadID, messageID);
                    
                    if (sent) {
                        global.client.onReply.push({
                            name: "bot",
                            messageID: sent.messageID,
                            author: senderID
                        });
                    }
                }
                return;
            } catch (error) {
                api.sendMessage("❌ Có lỗi xảy ra khi xử lý tin nhắn", threadID, messageID);
                return;
            }
        }
        
        if (body && containsTriggerWord(body)) {
            try {
                if (hasAttachmentImage || hasReplyImage) {
                    let imageUrl;
                    if (hasAttachmentImage) {
                        imageUrl = attachments.find(att => att.type === "photo").url;
                    } else {
                        imageUrl = messageReply.attachments.find(att => att.type === "photo").url;
                    }
                    
                    const imagePrompt = body || "Mô tả chi tiết hình ảnh này";
                    const response = await chatbot.analyzeImage(imageUrl, imagePrompt, senderID, threadID);
                    
                    const userMessage = body ? `[Hình ảnh] ${body}` : "[Hình ảnh]";
                    chatbot.updateHistory(threadID, userMessage, response, senderID);
                    
                    const sent = await api.sendMessage(response, threadID, messageID);
                    
                    if (sent) {
                        global.client.onReply.push({
                            name: "bot",
                            messageID: sent.messageID,
                            author: senderID
                        });
                    }
                    
                    return;
                }
                
                const response = await chatbot.generateResponse(body, senderID, threadID);
                
                chatbot.updateHistory(threadID, body, response, senderID);
                
                const sent = await api.sendMessage(response, threadID, messageID);
                
                if (sent) {
                    global.client.onReply.push({
                        name: "bot",
                        messageID: sent.messageID,
                        author: senderID
                    });
                }
                return;
            } catch (error) {
                api.sendMessage("❌ Có lỗi xảy ra khi xử lý tin nhắn", threadID, messageID);
                return;
            }
        }
    }
};