const express = require('express');
const path = require('path');
const { GoogleGenAI, Type } = require('@google/genai');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname)));

// 根據請求的模型名稱建立對應嘗試順序（支援 gemini-3.5-flash-lite 與 gemini-4-hydrogen）
function getModelCandidates(requestedModel) {
    const clean = String(requestedModel || 'gemini-3.5-flash-lite').trim();
    if (clean === 'gemini-3.5-flash-lite') {
        return ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'];
    }
    if (clean === 'gemini-4-hydrogen') {
        return ['gemini-4-hydrogen', 'gemini-3.1-flash-lite'];
    }
    return [clean, 'gemini-3.1-flash-lite', 'gemini-4-hydrogen'];
}

app.post('/api/gemini/dispatch', async (req, res) => {
    try {
        const {
            dispatchText,
            communities = [],
            model = 'gemini-3.5-flash-lite',
            apiKey: clientProvidedKey
        } = req.body || {};

        if (!dispatchText || typeof dispatchText !== 'string' || !dispatchText.trim()) {
            return res.status(400).json({ error: '請提供派工單文字內容' });
        }

        const effectiveApiKey = (clientProvidedKey && String(clientProvidedKey).trim()) || process.env.GEMINI_API_KEY;
        if (!effectiveApiKey) {
            return res.status(400).json({
                error: '尚未設定可用的 Gemini API Key，請先於管理員面板「🤖 AI 智慧派工設定」新增 API Key。',
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

        const communityListJson = JSON.stringify(
            Array.isArray(communities)
                ? communities.map(c => ({
                    name: String(c.title || c.name || '').trim(),
                    lat: Number(c.lat),
                    lng: Number(c.lng)
                })).filter(c => c.name && !isNaN(c.lat) && !isNaN(c.lng))
                : []
        );

        const promptText = `你是一個專業的新北市鶯歌區清潔隊大型家具清運派工解析助手。
以下是全車隊目前已標註的「鶯歌區社區大樓（橘色水滴）」清單（含名稱與精準經緯度）：
${communityListJson}

以下是使用者貼上的今日大型家具派工單文字：
"""
${dispatchText.trim()}
"""

請依序解析派工單中的每一個收運點位，並嚴格回傳 JSON 陣列。
解析規則：
1. order：從 1 開始依序編號 (1, 2, 3...)。
2. rawName：該站在派工單上的原始名稱或地址文字（不含多餘編號前綴）。
3. matchedCommunity：若該站名稱與上方「已標註社區大樓清單」中的某個社區名稱相同或高度相符（例如簡稱、漏字或包含社區名），請填入清單中該社區的完整 name；若不屬於清單中的社區大樓，請填寫空字串 ""。
4. lat 與 lng：若 matchedCommunity 有命中上方社區大樓清單，請直接填入該社區大樓的精準 lat 與 lng 數值；若未命中社區大樓，請填 0。
5. normalizedAddress：若為門牌地址或路名地標，請自動補全為「新北市鶯歌區...」開頭的完整標準地址（並將全形數字轉為半形阿拉伯數字，例如「新北市鶯歌區建國路120號」，移除樓層如「3樓」以利地圖門牌定位）；若已命中社區大樓，可填該社區名稱。
6. isPureWood：布林值 (true/false)。只要該站文字中有提及「純木頭」、「木頭」、「全木」、「純木」、「木櫃/木桌(標註木頭)」、「垃圾車支援」或「需垃圾車」等關鍵字，一律設為 true，否則設為 false。
7. note：提取該站的家具品項、數量、樓層或聯絡備註（例如「沙發1組、床墊2張」或「純木頭衣櫃」），若無則填空字串 ""。`;

        const responseSchema = {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    order: { type: Type.INTEGER, description: '站點順序 (1, 2, 3...)' },
                    rawName: { type: Type.STRING, description: '派工單上的原始地點或社區名稱' },
                    matchedCommunity: { type: Type.STRING, description: '命中的已標註社區大樓名稱，未命中則為空字串' },
                    lat: { type: Type.NUMBER, description: '命中的社區大樓精準緯度，未命中則為 0' },
                    lng: { type: Type.NUMBER, description: '命中的社區大樓精準經度，未命中則為 0' },
                    normalizedAddress: { type: Type.STRING, description: '補全為新北市鶯歌區開頭的標準門牌地址（不含樓層）' },
                    isPureWood: { type: Type.BOOLEAN, description: '是否提及純木頭、木頭或需垃圾車支援' },
                    note: { type: Type.STRING, description: '家具品項或備註說明' }
                },
                required: ['order', 'rawName', 'matchedCommunity', 'lat', 'lng', 'normalizedAddress', 'isPureWood', 'note']
            }
        };

        const candidates = getModelCandidates(model);
        let lastErr = null;
        let usedModel = model;

        for (const candidateModel of candidates) {
            try {
                const response = await ai.models.generateContent({
                    model: candidateModel,
                    contents: promptText,
                    config: {
                        responseMimeType: 'application/json',
                        responseSchema
                    }
                });
                const rawJson = (response.text || '[]').trim();
                const parsed = JSON.parse(rawJson);
                usedModel = candidateModel;
                return res.json({
                    items: Array.isArray(parsed) ? parsed : [],
                    usedModel
                });
            } catch (err) {
                lastErr = err;
                const status = err?.status || err?.httpStatusCode || (String(err?.message || '').includes('429') ? 429 : 0);
                const msg = String(err?.message || '');
                // 若為 429 RESOURCE_EXHAUSTED 或 API Key 無效，不需換模型重試，直接回傳讓前端切換下一組 Key
                if (status === 429 || msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')) {
                    return res.status(429).json({
                        error: '目前啟用的 API Key 已達額度上限 (HTTP 429)',
                        code: 'RESOURCE_EXHAUSTED'
                    });
                }
                if (status === 400 && (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid'))) {
                    return res.status(400).json({
                        error: 'API Key 無效，請檢查管理員面板中的金鑰設定',
                        code: 'API_KEY_INVALID'
                    });
                }
                // 若為 404 模型名稱別名差異，繼續嘗試下一個候選模型
            }
        }

        const errMsg = lastErr?.message || 'AI 解析失敗';
        const is429 = String(errMsg).includes('429') || String(errMsg).includes('RESOURCE_EXHAUSTED');
        return res.status(is429 ? 429 : 500).json({
            error: errMsg,
            code: is429 ? 'RESOURCE_EXHAUSTED' : 'GENERATION_FAILED'
        });
    } catch (err) {
        console.error('Gemini dispatch API error:', err);
        return res.status(500).json({
            error: err?.message || '伺服器處理 AI 派工請求失敗'
        });
    }
});

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});
