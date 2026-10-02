import { generateRaw, main_api } from '../../../../script.js';

const extensionHtml = `
<div id="canon-voice-settings" class="drawer-content">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>🎬 Canon Voice 原著台词库</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content" style="display: flex; flex-direction: column; gap: 15px; padding: 15px; background: rgba(0,0,0,0.2); border-radius: 8px;">
            <div>
                <label style="display:block; margin-bottom: 5px;"><b>1. 目标角色与集数</b></label>
                <input id="cv_character_name" class="text_pole" type="text" placeholder="例如：库洛洛 (留空则提取所有人)" style="width: 100%; box-sizing: border-box; margin-bottom: 8px;" />
                <input id="cv_episode" class="text_pole" type="text" placeholder="例如：第7集" style="width: 100%; box-sizing: border-box;" />
            </div>
            <hr style="margin: 0; border-color: rgba(255,255,255,0.1);">
            <div>
                <label style="display:block; margin-bottom: 5px;"><b>2. 自定义提取 Prompt</b></label>
                <textarea id="cv_prompt_template" class="text_pole" rows="3" style="width: 100%; box-sizing: border-box; resize: vertical;">请分析以下字幕内容。请根据剧情逻辑提取出台词，并标明场景上下文。输出格式必须为标准的 JSON 数组，包含 scene, speaker 和 line 字段。</textarea>
            </div>
            <hr style="margin: 0; border-color: rgba(255,255,255,0.1);">
            <div>
                <label style="display:block; margin-bottom: 5px;"><b>3. 上传字幕文件 (支持 SRT / ASS)</b></label>
                <input id="cv_srt_upload" type="file" accept=".srt,.ass" class="text_pole" style="width: 100%; box-sizing: border-box; padding: 8px; display: block; margin-bottom: 10px; background: rgba(255,255,255,0.05);" />
                <button id="cv_process_btn" class="menu_button" style="width: 100%; display: block; white-space: nowrap; padding: 10px;">开始让 AI 解析字幕</button>
            </div>
            <hr style="margin: 0; border-color: rgba(255,255,255,0.1);">
            <div>
                <label style="display:block; margin-bottom: 5px;"><b>4. AI 解析结果 (可手动修改)</b></label>
                <textarea id="cv_result_preview" class="text_pole" rows="8" placeholder="AI 提取出来的 JSON 台词会显示在这里..." style="width: 100%; box-sizing: border-box; resize: vertical; margin-bottom: 10px;"></textarea>
                <button id="cv_save_btn" class="menu_button" style="width: 100%; display: block; white-space: nowrap; padding: 10px;">保存入库 (生成世界书)</button>
            </div>
        </div>
    </div>
</div>
`;

async function initExtension() {
    try {
        $('#extensions_settings').append(extensionHtml);
        $('#cv_process_btn').on('click', processSrtFile);
        $('#cv_save_btn').on('click', saveToLorebook);
    } catch (e) {
        console.error("加载面板失败：", e);
    }
}

async function processSrtFile() {
    const charName = $('#cv_character_name').val().trim() || "全部登场角色";
    const episode = $('#cv_episode').val().trim() || "未知集数";
    const promptTemplate = $('#cv_prompt_template').val().trim();
    const fileInput = document.getElementById('cv_srt_upload');
    
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
            const currentApi = typeof main_api !== 'undefined' ? main_api : 'openai';
            const response = await generateRaw(finalPrompt, currentApi, true);
            $('#cv_result_preview').val(response);
            toastr.success('AI 解析完成！请检查台词后点击保存。');
        } catch (error) {
            console.error(error);
            $('#cv_result_preview').val("解析失败，请检查 API 是否连通。\n" + error);
        }
    };
    reader.readAsText(file);
}

// ============== 核心功能：保存为世界书 (按场景智能合并版) ==============
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

        // 1. 【核心优化】：按照 scene (场景) 将台词进行分组
        const sceneMap = {};
        lines.forEach(item => {
            const sceneName = item.scene;
            if (!sceneMap[sceneName]) {
                sceneMap[sceneName] = {
                    speakers: new Set(),
                    dialogues: []
                };
            }
            sceneMap[sceneName].speakers.add(item.speaker); // 收集这个场景出现过的角色
            // 把单句台词拼接成剧本格式，去除里面可能破坏 JSON 的双引号
            sceneMap[sceneName].dialogues.push(`[${item.speaker}] 说道：“${item.line.replace(/"/g, "'")}”`);
        });

        // 2. 将分组后的场景转换为条目，一个场景对应一个条目
        const entries = {};
        let index = 0;

        for (const [scene, data] of Object.entries(sceneMap)) {
            // 自动提取关键词：包括出场角色名 + 场景中的名词
            const sceneWords = scene.split(/[，。、\s]/).filter(k => k.length > 1);
            const keywords = Array.from(data.speakers).concat(sceneWords);

            entries[index.toString()] = {
                uid: index,
                key: keywords, 
                keysecondary: [],
                comment: `[${episode}] 场景：${scene.substring(0, 15)}...`, // 备注会标明集数，一目了然
                // 把该场景下的多句台词合并在一个内容里
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

        // 提示缩减了多少条目
        toastr.success(`世界书 [${lorebookName}] 已生成！已将 ${lines.length} 句话合并为 ${index} 个场景条目！`);

    } catch (e) {
        console.error("生成世界书失败:", e);
        toastr.error("生成世界书失败，请确保解析结果是完整的 JSON 格式！");
    }
}

jQuery(async () => {
    await initExtension();
});