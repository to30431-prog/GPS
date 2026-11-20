const express = require('express');
const path = require('path');
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

// 根據請求的模型名稱建立對應嘗試順序（同時支援 gemini-3.6-flash 與 gemini-4-hydrogen）
function getModelCandidates(requestedModel) {
    const clean = String(requestedModel || 'gemini-3.6-flash').trim();
    if (clean === 'gemini-4-hydrogen') {
        return ['gemini-4-hydrogen', 'gemini-2.5-flash', 'gemini-2.0-flash'];
    }
    return ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.0-flash'];
}

// 從 Gemini 回應文字中安全提取 JSON 陣列
function extractJsonArrayFromText(rawText) {
    const cleaned = String(rawText || '')
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
    try {
        const direct = JSON.parse(cleaned);
        if (Array.isArray(direct)) return direct;
    } catch (e) {}

    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        const sub = cleaned.slice(firstBracket, lastBracket + 1);
        const parsed = JSON.parse(sub);
        if (Array.isArray(parsed)) return parsed;
    }
    throw new Error('AI 回傳格式非有效 JSON 陣列');
}

app.post('/api/gemini/dispatch', async (req, res) => {
    try {
        const {
            dispatchText,
            communities = [],
            model = 'gemini-3.6-flash',
            apiKey: clientProvidedKey
        } = req.body || {};

        if (!dispatchText || typeof dispatchText !== 'string' || !dispatchText.trim()) {
            return res.status(400).json({ error: '400 Bad Request：請提供派工單文字內容', code: 'EMPTY_DISPATCH_TEXT' });
        }

        const selectedModel = String(model || 'gemini-3.6-flash').trim();
        const effectiveApiKey = (clientProvidedKey && String(clientProvidedKey).trim()) || String(process.env.GEMINI_API_KEY || '').trim();
        if (!effectiveApiKey) {
            return res.status(400).json({
                error: '400 MISSING_API_KEY：尚未設定可用的 Gemini API Key，請先於開發者模式「🤖 AI 智慧派工設定」新增 API Key。',
                code: 'MISSING_API_KEY'
            });
        }

        const ai = new GoogleGenAI({
            apiKey: effectiveApiKey,
            httpOptions: {
                headers: {
                    'User-Agent': 'aistudio-build'
                }
            }
        });

        const validCommunityNames = Array.isArray(communities)
            ? communities.map(c => String(c.title || c.name || '').trim()).filter(Boolean)
            : [];

        const communityListJson = JSON.stringify(validCommunityNames);

        const promptText = `你是一個專業的新北市鶯歌區清潔隊大型家具清運派工單文字整理助手。
你只需要負責「整理地址與社區名稱」並去除電話號碼、聯絡人等雜訊，嚴禁自行推測或編造經緯度座標。

以下是全車隊目前已建檔的「已標註社區大樓名稱清單（共 ${validCommunityNames.length} 處）」：
${communityListJson}

以下是使用者貼上的今日大型家具派工單文字：
"""
${dispatchText.trim()}
"""

請嚴格遵照以下規則萃取每一筆清運地點：
1. 若該筆地點為社區大樓（或與上方「已標註社區大樓名稱清單」相符／高度相似）：
   - 將 matchedCommunity 填入匹配到的清單內標準社區名稱（若清單內無完全對應但明確為社區名稱，填入該社區名稱）。
   - 將 name 設為該社區名稱（例如 "龍鳳呈祥"）。
   - 將 fullAddress 設為 "新北市鶯歌區" 加上該社區或門牌地址（去除電話與雜訊）。
2. 若該筆為一般門牌地址、巷弄或路段：
   - 去除電話號碼、手機、聯絡人稱呼、時間等雜訊，若有明顯鶯歌路名同音錯別字請修正為正確路名。
   - 將 name 設為簡潔門牌地址（例如 "建國路120號"）。
   - 將 fullAddress 自動補齊前綴為完整標準門牌地址（必須以 "新北市鶯歌區" 開頭，例如 "新北市鶯歌區建國路120號"，並去除幾樓之幾等樓層尾綴以便門牌定位）。
   - 將 matchedCommunity 設為 ""。
3. 純木頭判斷 (isPureWood)：只要該站文字中有提及「純木頭」、「木頭」、「全木」、「純木」、「木櫃/木桌/木床（標明木頭）」、「垃圾車支援」或「需垃圾車」等關鍵字，請將 isPureWood 設為 true，否則設為 false。
4. 嚴格只回傳 JSON 陣列（不要加任何額外解說文字，也不要回傳 lat/lng），每筆物件包含以下欄位：
   - order：順序（數字 1, 2, 3...）
   - name：顯示名稱（字串，例如 "龍鳳呈祥" 或 "建國路120號"）
   - fullAddress：完整標準地址（字串，自動補齊前綴為 "新北市鶯歌區..."，已去除電話與樓層雜訊）
   - matchedCommunity：匹配到的社區大樓名稱（字串，若為一般門牌則為 ""）
   - isPureWood：是否純木頭需垃圾車支援（布林值 true 或 false）
   - note：家具品項與數量備註（字串，例如 "沙發1組、床墊1張"，若無則為 ""）

輸出範例格式：
[{"order":1,"name":"龍鳳呈祥","fullAddress":"新北市鶯歌區龍鳳呈祥","matchedCommunity":"龍鳳呈祥","isPureWood":false,"note":"沙發1組"},{"order":2,"name":"建國路120號","fullAddress":"新北市鶯歌區建國路120號","matchedCommunity":"","isPureWood":true,"note":"純木頭衣櫃x2"}]`;

        const candidates = getModelCandidates(selectedModel);
        let lastErr = null;

        // 純文字模式呼叫（不掛載 google_search 工具以避免 429 錯誤）
        for (const candidateModel of candidates) {
            try {
                const response = await ai.models.generateContent({
                    model: candidateModel,
                    contents: promptText,
                    config: { temperature: 0.1 }
                });
                const rawText = (response.text || '[]').trim();
                const parsed = extractJsonArrayFromText(rawText);
                return res.json({
                    items: Array.isArray(parsed) ? parsed : [],
                    usedModel: selectedModel
                });
            } catch (err) {
                lastErr = err;
                const status = err?.status || err?.httpStatusCode || (String(err?.message || '').includes('429') ? 429 : 0);
                const msg = String(err?.message || '');
                if (status === 400 && (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid'))) {
                    return res.status(400).json({
                        error: 'HTTP 400 API_KEY_INVALID：API Key 無效，請檢查金鑰是否正確',
                        code: 'API_KEY_INVALID'
                    });
                }
                if (status === 403 || msg.includes('PERMISSION_DENIED')) {
                    return res.status(403).json({
                        error: `HTTP 403 PERMISSION_DENIED：API Key 權限遭拒 (${msg.slice(0, 120)})`,
                        code: 'PERMISSION_DENIED'
                    });
                }
            }
        }

        const errMsg = lastErr?.message || 'AI 解析失敗';
        const is429 = (lastErr?.status === 429 || lastErr?.httpStatusCode === 429 || String(errMsg).includes('429') || String(errMsg).includes('RESOURCE_EXHAUSTED'));
        const statusCode = is429 ? 429 : (lastErr?.status || lastErr?.httpStatusCode || 500);
        return res.status(statusCode).json({
            error: `HTTP ${statusCode}：${errMsg}`,
            code: is429 ? 'RESOURCE_EXHAUSTED' : 'GENERATION_FAILED'
        });
    } catch (err) {
        console.error('Gemini dispatch API error:', err);
        return res.status(500).json({
            error: `HTTP 500：${err?.message || '伺服器處理 AI 派工請求失敗'}`
        });
    }
});

// ⚡ 測試 API Key 連線端點（純文字輕量 "ping" 請求，不帶 google_search 工具避免觸發免費版 429）
app.post('/api/gemini/test', async (req, res) => {
    const startTime = Date.now();
    try {
        const {
            apiKey: clientProvidedKey,
            model = 'gemini-3.6-flash'
        } = req.body || {};

        const selectedModel = String(model || 'gemini-3.6-flash').trim();
        const effectiveApiKey = (clientProvidedKey && String(clientProvidedKey).trim()) || String(process.env.GEMINI_API_KEY || '').trim();
        if (!effectiveApiKey) {
            return res.status(400).json({
                ok: false,
                error: 'HTTP 400 MISSING_API_KEY：未提供 API Key'
            });
        }

        const ai = new GoogleGenAI({
            apiKey: effectiveApiKey,
            httpOptions: {
                headers: {
                    'User-Agent': 'aistudio-build'
                }
            }
        });

        const candidates = getModelCandidates(selectedModel);
        let lastErr = null;

        for (const candidateModel of candidates) {
            try {
                const response = await ai.models.generateContent({
                    model: candidateModel,
                    contents: [{ parts: [{ text: 'ping' }] }],
                    config: {
                        maxOutputTokens: 10
                    }
                });
                const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
                return res.json({
                    ok: true,
                    usedModel: selectedModel,
                    elapsedSec,
                    sampleText: String(response.text || '').trim().slice(0, 60)
                });
            } catch (err) {
                lastErr = err;
                const status = err?.status || err?.httpStatusCode || 0;
                const msg = String(err?.message || '');
                if (status === 400 && (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid'))) {
                    return res.status(400).json({
                        ok: false,
                        error: 'HTTP 400 API_KEY_INVALID：API Key 無效或格式錯誤'
                    });
                }
                if (status === 403 || msg.includes('PERMISSION_DENIED')) {
                    return res.status(403).json({
                        ok: false,
                        error: `HTTP 403 PERMISSION_DENIED：權限不足 (${msg.slice(0, 100)})`
                    });
                }
            }
        }

        const errMsg = lastErr?.message || '未知連線錯誤';
        const is429 = (lastErr?.status === 429 || lastErr?.httpStatusCode === 429 || String(errMsg).includes('429') || String(errMsg).includes('RESOURCE_EXHAUSTED'));
        const code = is429 ? 429 : (lastErr?.status || lastErr?.httpStatusCode || 500);
        return res.status(code).json({
            ok: false,
            error: `HTTP ${code}：${errMsg}`
        });
    } catch (err) {
        return res.status(500).json({
            ok: false,
            error: `HTTP 500：${err?.message || '伺服器測試連線失敗'}`
        });
    }
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
