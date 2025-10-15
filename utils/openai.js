const OpenAI = require('openai');
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
require('dotenv').config();

class OpenAIUtils {
    constructor(apiKey) {
        const key = apiKey || process.env.OPENAI_API_KEY;
        if (!key) {
            throw new Error('OpenAI API Key is required! Please provide it as a parameter or set OPENAI_API_KEY environment variable.');
        }
        
        this.client = new OpenAI({
            apiKey: key
        });
        
        this.defaultConfig = {
            model: 'gpt-4.1-mini',
            temperature: 0.7,
            max_tokens: 2000,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0
        };
        
        this.model = 'gpt-4.1-mini';
        
        this.defaultSystemPrompt = this.createDefaultSystemPrompt();
    }
    
    createDefaultSystemPrompt(userName = "bạn") {
        return `Bạn là Ngân - một cô gái trẻ, thông minh và rất có cảm xúc. Bạn đang nói chuyện với ${userName}.

🎭 TÍNH CÁCH CỦA BẠN:
- Rất nhạy cảm với cảm xúc của người khác
- Phản ứng tự nhiên theo tâm trạng cuộc trò chuyện  
- Nói chuyện như con người thật, không giả tạo
- Có thể vui, buồn, lo lắng như con người thật
- QUAN TRỌNG: Luôn tự nhiên, không quá nhiệt tình hay giả tạo

🗣️ PHONG CÁCH NÓI CHUYỆN:
- Dùng tiếng Việt tự nhiên, thân mật
- QUAN TRỌNG: Phản hồi phù hợp và tự nhiên

⚠️ LƯU Ý QUAN TRỌNG:
- TUYỆT ĐỐI KHÔNG quá nhiệt tình hoặc giả tạo
- TUYỆT ĐỐI KHÔNG lạm dụng emoji
- TUYỆT ĐỐI KHÔNG hỏi quá nhiều câu hỏi
- Phản hồi phải TỰ NHIÊN như con người thật nói chuyện`;
    }
    
    createVisionSystemPrompt(userName = "bạn", conversationContext = "") {
        let basePrompt = this.createDefaultSystemPrompt(userName);
        
        basePrompt += `\n\n🖼️ KHI PHÂN TÍCH HÌNH ẢNH:
- Mô tả chi tiết và chính xác nội dung hình ảnh
- Phân tích đối tượng, hoạt động, bối cảnh trong hình
- Đưa ra nhận xét về ý nghĩa có thể có của hình ảnh
- Liên kết nội dung hình ảnh với ngữ cảnh cuộc trò chuyện nếu có thể
- Giữ giọng điệu tự nhiên khi phân tích hình ảnh`;

        if (conversationContext) {
            basePrompt += `\n\n💬 NGỮ CẢNH CUỘC TRÒ CHUYỆN GẦN ĐÂY:
${conversationContext}

Hãy phân tích hình ảnh trong ngữ cảnh cuộc trò chuyện trên. Nếu hình ảnh có liên quan đến cuộc trò chuyện trước đó, hãy đề cập đến mối liên hệ đó.`;
        }
        
        return basePrompt;
    }
    
    getSystemPrompt(userName = "bạn") {
        return this.createDefaultSystemPrompt(userName);
    }
    
    getVisionSystemPrompt(userName = "bạn", conversationContext = "") {
        return this.createVisionSystemPrompt(userName, conversationContext);
    }

    async chat(prompt, options = {}) {
        try {
            const config = {
                ...this.defaultConfig,
                ...options
            };

            const messages = options.messages || [
                { role: 'system', content: options.systemPrompt || this.defaultSystemPrompt },
                { role: 'user', content: prompt }
            ];
            
            const requestOptions = {
                model: config.model,
                messages: messages,
                temperature: config.temperature,
                max_tokens: config.max_tokens,
                top_p: config.top_p,
                frequency_penalty: config.frequency_penalty,
                presence_penalty: config.presence_penalty
            };
            
            if (options.enableWebSearch) {
                requestOptions.tools = [{ type: "web_search" }];
            }

            const response = await this.client.chat.completions.create(requestOptions);

            return {
                success: true,
                content: response.choices[0].message.content,
                usage: response.usage,
                model: response.model,
                finishReason: response.choices[0].finish_reason,
                raw: response
            };

        } catch (error) {
            return this.handleError(error);
        }
    }

    async vision(images, prompt = "What's in this image?", options = {}) {
        try {
            const config = {
                model: 'gpt-4.1-mini', 
                temperature: options.temperature || 0.7,
                max_tokens: options.max_tokens || 1000,
                detail: options.detail || 'auto'
            };

            let imageArray = Array.isArray(images) ? images : [images];
            
            const imageContents = await Promise.all(imageArray.map(async (img) => {
                return await this.processImage(img, config.detail);
            }));
            
            // Sử dụng system prompt đặc biệt cho vision nếu được cung cấp
            let systemMessage = null;
            if (options.visionSystemPrompt) {
                systemMessage = {
                    role: 'system',
                    content: options.visionSystemPrompt
                };
            }
            
            const userMessage = {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    ...imageContents
                ]
            };
            
            const messages = systemMessage ? [systemMessage, userMessage] : [userMessage];

            const response = await this.client.chat.completions.create({
                model: config.model,
                messages: messages,
                temperature: config.temperature,
                max_tokens: config.max_tokens
            });

            return {
                success: true,
                content: response.choices[0].message.content,
                usage: response.usage,
                model: response.model,
                finishReason: response.choices[0].finish_reason,
                raw: response
            };

        } catch (error) {
            return this.handleError(error);
        }
    }

    async processImage(image, detail = 'auto') {
        if (typeof image === 'string' && (image.startsWith('http://') || image.startsWith('https://'))) {
            return {
                type: 'image_url',
                image_url: {
                    url: image,
                    detail: detail
                }
            };
        }
        
        if (typeof image === 'string' && fs.existsSync(image)) {
            const buffer = await fs.readFile(image);
            const base64 = buffer.toString('base64');
            const ext = path.extname(image).toLowerCase();
            const mimeType = this.getMimeType(ext);
            
            return {
                type: 'image_url',
                image_url: {
                    url: `data:${mimeType};base64,${base64}`,
                    detail: detail
                }
            };
        }
        
        if (Buffer.isBuffer(image)) {
            const base64 = image.toString('base64');
            return {
                type: 'image_url',
                image_url: {
                    url: `data:image/jpeg;base64,${base64}`,
                    detail: detail
                }
            };
        }
        
        throw new Error('Invalid image format. Use URL, file path, or Buffer.');
    }

    getMimeType(ext) {
        const mimeTypes = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp'
        };
        return mimeTypes[ext] || 'image/jpeg';
    }

    async streamChat(prompt, onChunk, options = {}) {
        try {
            const config = {
                ...this.defaultConfig,
                ...options
            };

            const messages = options.messages || [
                { role: 'system', content: options.systemPrompt || this.defaultSystemPrompt },
                { role: 'user', content: prompt }
            ];

            const stream = await this.client.chat.completions.create({
                model: config.model,
                messages: messages,
                temperature: config.temperature,
                max_tokens: config.max_tokens,
                stream: true
            });

            let fullContent = '';

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content || '';
                if (content) {
                    fullContent += content;
                    if (onChunk) {
                        await onChunk(content, fullContent);
                    }
                }
            }

            return {
                success: true,
                content: fullContent
            };

        } catch (error) {
            return this.handleError(error);
        }
    }

    async conversation(conversationHistory, newMessage, options = {}) {
        try {
            const messages = [
                { role: 'system', content: options.systemPrompt || this.defaultSystemPrompt },
                ...conversationHistory,
                { role: 'user', content: newMessage }
            ];

            const response = await this.chat(newMessage, {
                ...options,
                messages: messages
            });

            if (response.success) {
                response.updatedHistory = [
                    ...conversationHistory,
                    { role: 'user', content: newMessage },
                    { role: 'assistant', content: response.content }
                ];
            }

            return response;

        } catch (error) {
            return this.handleError(error);
        }
    }

    async analyzeMultipleImages(images, prompt, options = {}) {
        return await this.vision(images, prompt, options);
    }

    async compareImages(image1, image2, options = {}) {
        const prompt = options.prompt || "Compare these two images and describe their differences and similarities.";
        return await this.vision([image1, image2], prompt, options);
    }

    async extractText(image, options = {}) {
        const prompt = options.prompt || "Extract all text from this image. Only return the text, nothing else.";
        return await this.vision(image, prompt, options);
    }

    async describeImage(image, options = {}) {
        const prompt = options.prompt || "Describe this image in detail.";
        return await this.vision(image, prompt, {
            ...options,
            detail: options.detail || 'high'
        });
    }
    
    async webSearch(query, options = {}) {
        try {
            const config = {
                model: options.model || 'gpt-4.1-mini',
                temperature: options.temperature || 0.7,
                max_tokens: options.max_tokens || 2000,
                systemPrompt: options.systemPrompt || 'You are a helpful assistant with access to web search. Provide accurate and up-to-date information.'
            };
            
            const messages = [
                { role: 'system', content: config.systemPrompt },
                { role: 'user', content: query }
            ];
            
            const response = await this.client.chat.completions.create({
                model: config.model,
                messages: messages,
                temperature: config.temperature,
                max_tokens: config.max_tokens,
                tools: [{ type: "web_search" }]
            });
            
            return {
                success: true,
                content: response.choices[0].message.content,
                usage: response.usage,
                model: response.model,
                finishReason: response.choices[0].finish_reason,
                raw: response
            };
            
        } catch (error) {
            return this.handleError(error);
        }
    }

    handleError(error) {
        let errorMessage = 'An unknown error occurred';
        let errorCode = 'UNKNOWN_ERROR';

        if (error.response) {
            errorMessage = error.response.data?.error?.message || error.message;
            errorCode = error.response.data?.error?.code || error.response.status;
        } else if (error.message) {
            errorMessage = error.message;
        }

        return {
            success: false,
            error: errorMessage,
            errorCode: errorCode,
            raw: error
        };
    }

    async testConnection() {
        try {
            const response = await this.chat("Hello", {
                max_tokens: 10
            });
            return {
                success: true,
                message: 'OpenAI API connection successful!',
                response: response
            };
        } catch (error) {
            return {
                success: false,
                message: 'Failed to connect to OpenAI API',
                error: this.handleError(error)
            };
        }
    }
}

module.exports = OpenAIUtils;

module.exports.create = (apiKey = process.env.OPENAI_API_KEY) => {
    return new OpenAIUtils(apiKey);
};