import { generateRaw, main_api } from '../../../../script.js';

const extensionHtml = `
<!-- 回归官方纯正的 inline-drawer 结构，彻底解决重叠，并完美继承主题颜色 -->
<div id="canon-voice-settings" class="inline-drawer">
    <div class="inline-drawer-toggle inline-drawer-header">
        <b>🎬 Canon Voice 原著台词库</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
    </div>
    
    <div class="inline-drawer-content" style="display: flex; flex-direction: column; gap: 15px; padding-top: 15px;">
        <div>
            <label style="display:block; margin-bottom: 5px;"><b>1. 目标角色与集数</b></label>
            <input id="cv_character_name" class="text_pole" type="text" placeholder="例如：库洛洛 (留空则提取所有人)" style="width: 100%; box-sizing: border-box; margin-bottom: 8px;" />
            <input id="cv_episode" class="text_pole" type="text" placeholder="例如：第8集" style="width: 100%; box-sizing: border-box;" />
        </div>
        
        <hr class="sysHR" />

        <details style="cursor: pointer;">
            <summary style="font-weight: bold; margin-bottom: 5px; outline: none; color: #6db33f;">🔧 独立 API 设置 (不填则默认使用酒馆主 API)</summary>
            <div style="display: flex; flex-direction: column; gap: 8px; margin-top: 8px; padding: 10px; background: rgba(0,0,0,0.2); border-radius: 6px;">
                <label style="font-size: 0.9em; opacity: 0.8;">自定义 API 基础 URL (兼容 OpenAI 格式):</label>
                <input id="cv_custom_url" class="text_pole" type="text" placeholder="如: https://catiecli.sukaka.top/v1" style="width: 100%; box-sizing: border-box;" />
                <label style="font-size: 0.9em; opacity: 0.8;">自定义 API 密钥:</label>
                <input id="cv_custom_key" class="text_pole" type="password" placeholder="sk-..." style="width: 100%; box-sizing: border-box;" />
                <label style="font-size: 0.9em; opacity: 0.8;">自定义模型名称:</label>
                <input id="cv_custom_model" class="text_pole" type="text" placeholder="如: gemini-1.5-flash" style="width: 100%; box-sizing: border-box;" />
            </div>
        </details>
        
        <hr class="sysHR" />

        <div>
            <label style="display:block; margin-bottom: 5px;"><b>2. 自定义提取 Prompt</b></label>
            <textarea id="cv_prompt_template" class="text_pole" rows="3" style="width: 100%; box-sizing: border-box; resize: vertical;">请分析以下字幕内容。请根据剧情逻辑提取出台词，并标明场景上下文。输出格式必须为标准的 JSON 数组，包含 scene, speaker 和 line 字段。</textarea>
        </div>
        
        <hr class="sysHR" />
        
        <div>
            <label style="display:block; margin-bottom: 5px;"><b>3. 上传字幕文件 (支持 SRT / ASS)</b></label>
            <input id="cv_srt_upload" type="file" accept=".srt,.ass" class="text_pole" style="width: 100%; box-sizing: border-box; padding: 8px; display: block; margin-bottom: 10px;" />
            <button id="cv_process_btn" class="menu_button" style="width: 100%; display: block; white-space: nowrap; padding: 10px;">开始让 AI 解析字幕</button>
        </div>
        
        <hr class="sysHR" />
        
        <div>
            <label style="display:block; margin-bottom: 5px;"><b>4. AI 解析结果 (可手动修改)</b></label>
            <textarea id="cv_result_preview" class="text_pole" rows="8" placeholder="AI 提取出来的 JSON 台词会显示在这里..." style="width: 100%; box-sizing: border-box; resize: vertical; margin-bottom: 10px;"></textarea>
            
            <div style="display: flex; gap: 10px;">
                <button id="cv_save_btn" class="menu_button" style="flex: 2; white-space: nowrap; padding: 10px;">保存入库 (生成世界书)</button>
                <button id="cv_clear_btn" class="menu_button" style="flex: 1; white-space: nowrap; padding: 10px; background: rgba(200, 50, 50, 0.4);">清空结果</button>
            </div>
        </div>
    </div>
</div>
`;

async function initExtension() {
    try {
        $('#extensions_settings').append(extensionHtml);
        
        $('#cv_custom_url').val(localStorage.getItem('cv_custom_url') || '');
        $('#cv_custom_key').val(localStorage.getItem('cv_custom_key') || '');
        $('#cv_custom_model').val(localStorage.getItem('cv_custom_model') || '');

        $('#cv_process_btn').on('click', processSrtFile);
        $('#cv_save_btn').on('click', saveToLorebook);
        
        $('#cv_clear_btn').on('click', () => {
            $('#cv_result_preview').val('');
            toastr.info('已清空解析结果，可重新上传或修改 Prompt。');
        });

    } catch (e) {
        console.error("加载面板失败：", e);
    }
}

async function processSrtFile() {
    const charName = $('#cv_character_name').val().trim() || "全部登场角色";
    const episode = $('#cv_episode').val().trim() || "未知集数";
    const promptTemplate = $('#cv_prompt_template').val().trim();
    const fileInput = document.getElementById('cv_srt_upload');
    
    const customUrl = $('#cv_custom_url').val().trim();
    const customKey = $('#cv_custom_key').val().trim();
    const customModel = $('#cv_custom_model').val().trim();
    localStorage.setItem('cv_custom_url', customUrl);
    localStorage.setItem('cv_custom_key', customKey);
    localStorage.setItem('cv_custom_model', customModel);
    
    if (fileInput.files.length === 0) {
        toastr.warning('必须先选择一个字幕文件！');
        return;
    }

    const file = fileInput.files[0];
    const reader = new FileReader();

    reader.onload = async function(e) {
        const srtContent = e.target.result;
        let finalPrompt = `${promptTemplate}\n\n`;
        finalPrompt += `【剧情范围/集数】：${episode}\n`;
        if (charName === "全部登场角色") {
            finalPrompt += `【提取要求】：请提取字幕中**所有主要角色**的台词，并在 JSON 中增加 "speaker" 字段标明是谁说的。\n`;
        } else {
            finalPrompt += `【目标提取角色】：仅提取【${charName}】的台词。\n`;
        }
        finalPrompt += `【原始字幕内容】(请忽略时间轴和特效代码，只提取汉字台词)：\n${srtContent}`;

        $('#cv_result_preview').val("正在呼叫 AI 解析字幕，这可能会耗时几十秒，请耐心等待...");
        
        try {
            if (customUrl) {
                let endpoint = customUrl;
                if (!endpoint.endsWith('/chat/completions')) {
                    endpoint = endpoint.replace(/\/$/, '') + '/chat/completions';
                }
                
                const fetchResponse = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${customKey}`
                    },
                    body: JSON.stringify({
                        model: customModel || "gpt-3.5-turbo",
                        messages: [{"role": "user", "content": finalPrompt}],
                        temperature: 0.1
                    })
                });
                
                if (!fetchResponse.ok) throw new Error(`自定义 API 请求失败: ${fetchResponse.status}`);
                const data = await fetchResponse.json();
                $('#cv_result_preview').val(data.choices[0].message.content);
                toastr.success('✅ 解析完成！(使用的独立 API)');
                
            } else {
                const currentApi = typeof main_api !== 'undefined' ? main_api : 'openai';
                const response = await generateRaw(finalPrompt, currentApi, true);
                $('#cv_result_preview').val(response);
                toastr.success('✅ 解析完成！(使用的酒馆主 API)');
            }
        } catch (error) {
            console.error(error);
            $('#cv_result_preview').val("解析失败，请检查 API 设置是否正确连通。\n" + error);
        }
    };
    reader.readAsText(file);
}

function saveToLorebook() {
    const resultText = $('#cv_result_preview').val();
    if (!resultText || !resultText.includes('[')) {
        toastr.warning("框内没有检测到有效的 JSON 台词，无法保存！");
        return;
    }

    try {
        const jsonStr = resultText.substring(resultText.indexOf('['), resultText.lastIndexOf(']') + 1);
        const lines = JSON.parse(jsonStr);
        
        const charName = $('#cv_character_name').val().trim() || "群像";
        const episode = $('#cv_episode').val().trim() || "未知集数";
        const lorebookName = `【${charName}】原著台词库`;

        const sceneMap = {};
        lines.forEach(item => {
            const sceneName = item.scene;
            if (!sceneMap[sceneName]) {
                sceneMap[sceneName] = {
                    speakers: new Set(),
                    dialogues: []
                };
            }
            sceneMap[sceneName].speakers.add(item.speaker);
            sceneMap[sceneName].dialogues.push(`[${item.speaker}] 说道：“${item.line.replace(/"/g, "'")}”`);
        });

        const entries = {};
        let index = 0;

        for (const [scene, data] of Object.entries(sceneMap)) {
            const sceneWords = scene.split(/[，。、\s]/).filter(k => k.length > 1);
            const keywords = Array.from(data.speakers).concat(sceneWords);

            entries[index.toString()] = {
                uid: index,
                key: keywords, 
                keysecondary: [],
                comment: `[${episode}] 场景：${scene.substring(0, 15)}...`, 
                content: `[剧情引导：当前情境高度符合“${scene}”。以下为该场景下的原著台词参考，若剧情触发至此，请让角色自然地运用这些台词：\n${data.dialogues.join('\n')}]`,
                constant: false,
                vectorized: false, 
                insertion_order: 50,
                position: 1, 
                enabled: true
            };
            index++;
        }

        const lorebook = {
            entries: entries,
            name: lorebookName
        };

        const blob = new Blob([JSON.stringify(lorebook, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${lorebookName}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        toastr.success(`🎉 世界书 [${lorebookName}] 已生成并触发下载！`);

    } catch (e) {
        console.error("生成世界书失败:", e);
        toastr.error("生成失败，请确认解析出来的结果是完整的 JSON 格式！");
    }
}

jQuery(async () => {
    await initExtension();
});