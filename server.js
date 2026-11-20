const express = require('express');
const path = require('path');
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

// 根據請求的模型名稱建立對應嘗試順序（支援 gemini-3.6-flash 與 gemini-4-hydrogen）
function getModelCandidates(requestedModel) {
    const clean = String(requestedModel || 'gemini-3.6-flash').trim();
    if (clean === 'gemini-4-hydrogen') {
        return ['gemini-4-hydrogen', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-3.1-flash-lite'];
    }
    return ['gemini-3.6-flash', 'gemini-3.1-flash-lite', 'gemini-2.5-flash', 'gemini-4-hydrogen'];
}

// 從 Gemini 聯網回應文字中安全提取 JSON 陣列
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

        const effectiveApiKey = (clientProvidedKey && String(clientProvidedKey).trim()) || process.env.GEMINI_API_KEY;
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

        const validCommunities = Array.isArray(communities)
            ? communities.map(c => ({
                name: String(c.title || c.name || '').trim(),
                lat: Number(c.lat),
                lng: Number(c.lng)
            })).filter(c => c.name && !isNaN(c.lat) && !isNaN(c.lng))
            : [];

        const communityListJson = JSON.stringify(validCommunities);

        const promptText = `你是一個專業的新北市鶯歌區清潔隊大型家具清運派工定位助手，具備 Google 搜尋聯網能力（Google Search Grounding）。
以下是全車隊目前已標註的「已標註社區大樓清單（共 ${validCommunities.length} 處）」（含社區名稱與精準 WGS84 經緯度）：
${communityListJson}

以下是使用者貼上的今日大型家具派工單文字：
"""
${dispatchText.trim()}
"""

請嚴格遵照以下步驟解析每一筆派工點位並查出真實經緯度：
1. 優先比對附帶的「已標註社區大樓清單（${validCommunities.length} 處）」：若派工單上的名稱與清單中的社區相符或高度相似（例如簡稱或漏字），直接採用清單中的精準 lat、lng，並將 source 設為 "community"。
2. 若不在已標註清單內（例如一般門牌地址、巷弄或地標）：你必須使用 Google 搜尋（google_search）上網查詢「新北市鶯歌區＋該地址」的實際地理位置與經緯度座標（WGS84 格式，鶯歌區 lat 約在 24.93~24.98 之間，lng 約在 121.31~121.36 之間）。若地址有明顯錯別字（例如同音異字），也請透過 Google 搜尋自動修正為鶯歌區正確路名與門牌座標，並將 source 設為 "google_search"。
3. 純木頭判斷 (isPureWood)：只要該站文字中有提及「純木頭」、「木頭」、「全木」、「純木」、「木櫃/木桌/木床（標明木頭）」、「垃圾車支援」或「需垃圾車」等關鍵字，請將 isPureWood 設為 true，否則設為 false。
4. 嚴格只回傳 JSON 陣列（不要加任何額外解說文字），每筆物件必須包含以下欄位：
   - order：順序（數字 1, 2, 3...）
   - name：顯示名稱（字串，若有修正錯別字請顯示修正後的正確名稱或社區名）
   - source：來源標註（字串，只能是 "community" 代表命中社區資料庫，或 "google_search" 代表 AI 上網查得）
   - lat：緯度（數字，例如 24.95421）
   - lng：經度（數字，例如 121.34612）
   - isPureWood：是否純木頭需垃圾車支援（布林值 true 或 false）
   - note：家具品項與數量備註（字串，例如 "沙發1組、床墊1張"，若無則為 ""）

輸出範例格式：
[{"order":1,"name":"龍鳳呈祥","source":"community","lat":24.95612,"lng":121.34215,"isPureWood":false,"note":"沙發1組"},{"order":2,"name":"建國路120號","source":"google_search","lat":24.95318,"lng":121.34892,"isPureWood":true,"note":"純木頭衣櫃x2"}]`;

        const candidates = getModelCandidates(model);
        let lastErr = null;
        let usedModel = model;

        for (const candidateModel of candidates) {
            try {
                const response = await ai.models.generateContent({
                    model: candidateModel,
                    contents: promptText,
                    config: {
                        tools: [{ googleSearch: {} }]
                    }
                });
                const rawText = (response.text || '[]').trim();
                const parsed = extractJsonArrayFromText(rawText);
                usedModel = candidateModel;
                return res.json({
                    items: Array.isArray(parsed) ? parsed : [],
                    usedModel
                });
            } catch (err) {
                lastErr = err;
                const status = err?.status || err?.httpStatusCode || (String(err?.message || '').includes('429') ? 429 : 0);
                const msg = String(err?.message || '');
                if (status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
                    return res.status(429).json({
                        error: `HTTP 429 RESOURCE_EXHAUSTED：API Key 額度已達上限 (${msg.slice(0, 120)})`,
                        code: 'RESOURCE_EXHAUSTED'
                    });
                }
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

        const errMsg = lastErr?.message || 'AI 聯網解析失敗';
        const statusCode = lastErr?.status || lastErr?.httpStatusCode || (String(errMsg).includes('429') ? 429 : 500);
        return res.status(statusCode).json({
            error: `HTTP ${statusCode}：${errMsg}`,
            code: statusCode === 429 ? 'RESOURCE_EXHAUSTED' : 'GENERATION_FAILED'
        });
    } catch (err) {
        console.error('Gemini dispatch API error:', err);
        return res.status(500).json({
            error: `HTTP 500：${err?.message || '伺服器處理 AI 派工請求失敗'}`
        });
    }
});

// ⚡ 管理員測試 API Key 與 Google Search 聯網功能端點
app.post('/api/gemini/test', async (req, res) => {
    const startTime = Date.now();
    try {
        const {
            apiKey: clientProvidedKey,
            model = 'gemini-3.6-flash'
        } = req.body || {};

        const effectiveApiKey = (clientProvidedKey && String(clientProvidedKey).trim()) || process.env.GEMINI_API_KEY;
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

        const candidates = getModelCandidates(model);
        let lastErr = null;

        for (const candidateModel of candidates) {
            try {
                const response = await ai.models.generateContent({
                    model: candidateModel,
                    contents: '請使用 Google 搜尋查詢「新北市鶯歌區公所」的經緯度座標，並只回傳一行 JSON：{"lat":24.95,"lng":121.35}',
                    config: {
                        tools: [{ googleSearch: {} }]
                    }
                });
                const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
                return res.json({
                    ok: true,
                    usedModel: candidateModel,
                    elapsedSec,
                    sampleText: String(response.text || '').trim().slice(0, 120)
                });
            } catch (err) {
                lastErr = err;
                const status = err?.status || err?.httpStatusCode || 0;
                const msg = String(err?.message || '');
                if (status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
                    return res.status(429).json({
                        ok: false,
                        error: 'HTTP 429 RESOURCE_EXHAUSTED：此組 API Key 額度已滿或受速率限制'
                    });
                }
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
        const code = lastErr?.status || lastErr?.httpStatusCode || 500;
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
