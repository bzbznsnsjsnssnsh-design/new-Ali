// JavaScript Internationalization Support for TTSFM

// Translation data - this will be populated by the server
window.i18nData = window.i18nData || {};

// Current locale
window.currentLocale = document.documentElement.lang || 'en';

// Translation function
function _(key, params = {}) {
    const keys = key.split('.');
    let value = window.i18nData;
    
    // Navigate through the nested object
    for (const k of keys) {
        if (value && typeof value === 'object' && k in value) {
            value = value[k];
        } else {
            // Fallback to key if translation not found
            return key;
        }
    }
    
    // If we found a string, apply parameters
    if (typeof value === 'string') {
        return formatString(value, params);
    }
    
    // Fallback to key
    return key;
}

// Format string with parameters
function formatString(str, params) {
    return str.replace(/\{(\w+)\}/g, (match, key) => {
        return params.hasOwnProperty(key) ? params[key] : match;
    });
}

// Load translations from server
async function loadTranslations() {
    try {
        const response = await fetch(`/api/translations/${window.currentLocale}`);
        if (response.ok) {
            window.i18nData = await response.json();
        }
    } catch (error) {
        console.warn('Failed to load translations:', error);
    }
}

// Sample texts for different languages
const sampleTexts = {
    en: {
        welcome: "Welcome to TTSFM! This is a free text-to-speech service that converts your text into high-quality audio using advanced AI technology.",
        story: "Once upon a time, in a digital world far away, there lived a small Python package that could transform any text into beautiful speech. This package was called TTSFM, and it brought joy to developers everywhere.",
        technical: "TTSFM is a Python client for text-to-speech APIs that provides both synchronous and asynchronous interfaces. It supports multiple voices and audio formats, making it perfect for various applications.",
        multilingual: "TTSFM supports multiple languages and voices, allowing you to create diverse audio content for global audiences. The service is completely free and requires no API keys.",
        long: "This is a longer text sample designed to test the auto-combine feature of TTSFM. When text exceeds the maximum length limit, TTSFM automatically splits it into smaller chunks, generates audio for each chunk, and then seamlessly combines them into a single audio file. This process is completely transparent to the user and ensures that you can convert text of any length without worrying about technical limitations. The resulting audio maintains consistent quality and natural flow throughout the entire content."
    },
    zh: {
        welcome: "欢迎使用TTSFM！这是一个免费的文本转语音服务，使用先进的AI技术将您的文本转换为高质量音频。",
        story: "很久很久以前，在一个遥远的数字世界里，住着一个小小的Python包，它能够将任何文本转换成美妙的语音。这个包叫做TTSFM，它为世界各地的开发者带来了快乐。",
        technical: "TTSFM是一个用于文本转语音API的Python客户端，提供同步和异步接口。它支持多种声音和音频格式，非常适合各种应用。",
        multilingual: "TTSFM支持多种语言和声音，让您能够为全球受众创建多样化的音频内容。该服务完全免费，无需API密钥。",
        long: "这是一个较长的文本示例，用于测试TTSFM的自动合并功能。当文本超过最大长度限制时，TTSFM会自动将其分割成较小的片段，为每个片段生成音频，然后无缝地将它们合并成一个音频文件。这个过程对用户完全透明，确保您可以转换任何长度的文本，而无需担心技术限制。生成的音频在整个内容中保持一致的质量和自然的流畅性。"
    }
};

// Get sample text for current locale
function getSampleText(type) {
    const locale = window.currentLocale;
    const texts = sampleTexts[locale] || sampleTexts.en;
    return texts[type] || texts.welcome;
}

// Error messages
const errorMessages = {
    en: {
        empty_text: "Please enter some text to convert.",
        generation_failed: "Failed to generate speech. Please try again.",
        network_error: "Network error. Please check your connection and try again.",
        invalid_format: "Invalid audio format selected.",
        invalid_voice: "Invalid voice selected.",
        text_too_long: "Text is too long. Please reduce the length or enable auto-combine.",
        server_error: "Server error. Please try again later."
    },
    zh: {
        empty_text: "请输入要转换的文本。",
        generation_failed: "语音生成失败。请重试。",
        network_error: "网络错误。请检查您的连接并重试。",
        invalid_format: "选择的音频格式无效。",
        invalid_voice: "选择的声音无效。",
        text_too_long: "文本太长。请减少长度或启用自动合并。",
        server_error: "服务器错误。请稍后重试。"
    }
};

// Success messages
const successMessages = {
    en: {
        generation_complete: "Speech generated successfully!",
        text_copied: "Text copied to clipboard!",
        download_started: "Download started!"
    },
    zh: {
        generation_complete: "语音生成成功！",
        text_copied: "文本已复制到剪贴板！",
        download_started: "下载已开始！"
    }
};

// Get error message
function getErrorMessage(key) {
    const locale = window.currentLocale;
    const messages = errorMessages[locale] || errorMessages.en;
    return messages[key] || key;
}

// Get success message
function getSuccessMessage(key) {
    const locale = window.currentLocale;
    const messages = successMessages[locale] || successMessages.en;
    return messages[key] || key;
}

// Format file size
function formatFileSize(bytes) {
    if (bytes === 0) return '0 Bytes';
    
    const k = 1024;
    const sizes = window.currentLocale === 'zh' 
        ? ['字节', 'KB', 'MB', 'GB'] 
        : ['Bytes', 'KB', 'MB', 'GB'];
    
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format duration
function formatDuration(seconds) {
    if (isNaN(seconds) || seconds < 0) {
        return window.currentLocale === 'zh' ? '未知' : 'Unknown';
    }
    
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    
    if (minutes > 0) {
        return window.currentLocale === 'zh' 
            ? `${minutes}分${remainingSeconds}秒`
            : `${minutes}m ${remainingSeconds}s`;
    } else {
        return window.currentLocale === 'zh' 
            ? `${remainingSeconds}秒`
            : `${remainingSeconds}s`;
    }
}

// Update UI text based on current locale
function updateUIText() {
    // Update button texts
    const generateBtn = document.getElementById('generate-btn');
    if (generateBtn && !generateBtn.disabled) {
        generateBtn.innerHTML = window.currentLocale === 'zh' 
            ? '<i class="fas fa-magic me-2"></i>生成语音'
            : '<i class="fas fa-magic me-2"></i>Generate Speech';
    }
    
    // Update other dynamic text elements
    const charCountElement = document.querySelector('#char-count');
    if (charCountElement) {
        const count = charCountElement.textContent;
        const parent = charCountElement.parentElement;
        if (parent) {
            // Escape HTML characters to prevent XSS
            const escapedCount = count.replace(/&/g, '&amp;')
                                     .replace(/</g, '&lt;')
                                     .replace(/>/g, '&gt;')
                                     .replace(/"/g, '&quot;')
                                     .replace(/'/g, '&#x27;');
            
            parent.innerHTML = window.currentLocale === 'zh'
                ? `<i class="fas fa-keyboard me-1"></i><span id="char-count">${escapedCount}</span> 字符`
                : `<i class="fas fa-keyboard me-1"></i><span id="char-count">${escapedCount}</span> characters`;
        }
    }
}

// Initialize i18n
function initI18n() {
    // Load translations if needed
    loadTranslations();
    
    // Update UI text
    updateUIText();
    
    // Listen for language changes
    document.addEventListener('languageChanged', function(event) {
        window.currentLocale = event.detail.locale;
        loadTranslations().then(() => {
            updateUIText();
        });
    });
}

// Export functions for global use
window._ = _;
window.getSampleText = getSampleText;
window.getErrorMessage = getErrorMessage;
window.getSuccessMessage = getSuccessMessage;
window.formatFileSize = formatFileSize;
window.formatDuration = formatDuration;
window.initI18n = initI18n;

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initI18n);
} else {
    initI18n();
}
