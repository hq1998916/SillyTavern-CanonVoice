import * as MainScript from '../../../../script.js';
import * as WI from '../../../world-info.js';

let cv_backup_data = null;
let cv_backup_name = "";

const extensionHtml = `
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
                <label style="font-size: 0.9em; opacity: 0.8;">自定义 API URL (兼容 OpenAI 格式):</label>
                <input id="cv_custom_url" class="text_pole" type="text" placeholder="如: https://catiecli.sukaka.top/v1" style="width: 100%; box-sizing: border-box;" />
                <label style="font-size: 0.9em; opacity: 0.8;">自定义 API 密钥:</label>
                <input id="cv_custom_key" class="text_pole" type="password" placeholder="sk-..." style="width: 100%; box-sizing: border-box;" />
                <label style="font-size: 0.9em; opacity: 0.8;">自定义模型名称:</label>
                <input id="cv_custom_model" class="text_pole" type="text" placeholder="如: gemini-1.5-flash" style="width: 100%; box-sizing: border-box;" />
            </div>
        </details>
        
        <hr class="sysHR" />

        <div>
            <label style="display:block; margin-bottom: 5px;"><b>2. 上传并解析字幕 (支持 SRT / ASS)</b></label>
            <textarea id="cv_prompt_template" class="text_pole" rows="2" style="width: 100%; box-sizing: border-box; resize: vertical; margin-bottom: 8px;">请分析以下字幕内容。请根据剧情逻辑提取出台词，并标明场景上下文。输出格式必须为标准的 JSON 数组，包含 scene, speaker 和 line 字段。</textarea>
            <input id="cv_srt_upload" type="file" accept=".srt,.ass" class="text_pole" style="width: 100%; box-sizing: border-box; padding: 8px; display: block; margin-bottom: 8px;" />
            <button id="cv_process_btn" class="menu_button" style="width: 100%; display: block; white-space: nowrap; padding: 10px;">开始让 AI 解析字幕</button>
        </div>
        
        <hr class="sysHR" />
        
        <div>
            <label style="display:block; margin-bottom: 5px;"><b>3. 缓冲池与入库 (直连数据库)</b></label>
            <div style="display: flex; gap: 8px; margin-bottom: 8px;">
                <select id="cv_wb_select" class="text_pole" style="flex: 3; box-sizing: border-box;"></select>
                <button id="cv_refresh_wb_btn" class="menu_button" style="flex: 1;" title="刷新列表">🔄 刷新</button>
            </div>
            
            <textarea id="cv_result_preview" class="text_pole" rows="6" placeholder="AI 解析完的数据会暂存在这里缓冲。确认无误后点击下方按钮写入..." style="width: 100%; box-sizing: border-box; resize: vertical; margin-bottom: 10px;"></textarea>
            
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <button id="cv_commit_btn" class="menu_button" style="width: 100%; white-space: nowrap; padding: 10px; background: rgba(50, 200, 50, 0.3);">📥 确认追加到选中的世界书</button>
                <div style="display: flex; gap: 8px;">
                    <button id="cv_undo_btn" class="menu_button" style="flex: 1; white-space: nowrap; padding: 10px; background: rgba(200, 150, 50, 0.3); display: none;">↩️ 撤回上一次追加</button>
                </div>
            </div>
        </div>
    </div>
</div>
`;

// 获取安全令牌
function getHeaders() {
    if (typeof MainScript.getRequestHeaders === 'function') {
        return MainScript.getRequestHeaders();
    }
    const headers = { 'Content-Type': 'application/json' };
    headers['X-CSRF-Token'] = window.csrf_token || window.token || document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    return headers;
}

// 刷新世界书下拉框
async function refreshWbDropdown() {
    const select = $('#cv_wb_select');
    select.empty();
    select.append('<option value="__NEW__">➕ [新建一本世界书...]</option>');
    
    try {
        let namesArray = [];
        if (Array.isArray(WI.world_names) && WI.world_names.length > 0) {
            namesArray = [...WI.world_names];
        } else if (WI.world_info) {
            if (Array.isArray(WI.world_info)) {
                namesArray = WI.world_info.map(b => b && b.name).filter(Boolean);
            } else {
                namesArray = Object.keys(WI.world_info);
            }
        }
        namesArray = [...new Set(namesArray)].sort();
        if (namesArray.length > 0) {
            namesArray.forEach(name => {
                select.append($('<option>', { value: name, text: '📖 ' + name }));
            });
        }
    } catch (e) {
        console.error("[CanonVoice] 读取列表失败:", e);
    }
}

// 【核心修复】精准获取旧数据，无论底层是对象还是数组都能准确提取，防止覆盖
async function getWbData(name) {
    let bookData = null;
    
    // 1. 智能适配读取内存
    if (WI.world_info) {
        if (Array.isArray(WI.world_info)) {
            bookData = WI.world_info.find(b => b && b.name === name);
        } else {
            bookData = WI.world_info[name] || Object.values(WI.world_info).find(b => b && b.name === name);
        }
    }
    
    // 2. 内存读取失败的保底
    if (!bookData) {
        try {
            const res = await fetch('/api/worldinfo/get', { method: 'POST', headers: getHeaders(), body: JSON.stringify({name: name}) });
            if (res.ok) {
                const data = await res.json();
                bookData = data.name ? data : (data[name] || data.data);
            }
        } catch(e) {}
    }

    // 3. 强制把旧数据的 entries 洗成字典，确保追加时的安全
    if (bookData) {
        let copy = JSON.parse(JSON.stringify(bookData));
        let normalizedEntries = {};
        if (copy.entries) {
            Object.values(copy.entries).forEach(e => {
                if (e && e.uid !== undefined) {
                    normalizedEntries[e.uid.toString()] = e;
                }
            });
        }
        copy.entries = normalizedEntries;
        return copy;
    }
    
    return { entries: {}, name: name };
}

// 写入数据
async function saveWbApi(name, wbData) {
    try {
        // 更新内存
        if (WI.world_info) {
            if (Array.isArray(WI.world_info)) {
                let idx = WI.world_info.findIndex(b => b && b.name === name);
                if (idx !== -1) WI.world_info[idx] = wbData;
                else WI.world_info.push(wbData);
            } else {
                WI.world_info[name] = wbData;
            }
        }

        // 调用酒馆原生保存
        if (typeof WI.editWorldInfo === 'function') {
            await WI.editWorldInfo(name, wbData);
            if (typeof WI.loadWorldInfo === 'function') await WI.loadWorldInfo();
            return true;
        }
        if (typeof WI.saveWorldInfo === 'function') {
            await WI.saveWorldInfo(name, wbData);
            if (typeof WI.loadWorldInfo === 'function') await WI.loadWorldInfo();
            return true;
        }

        const body = JSON.stringify({ name: name, data: wbData });
        const res = await fetch('/api/worldinfo/edit', { method: 'POST', headers: getHeaders(), body });
        if (res.ok) {
            if (typeof WI.loadWorldInfo === 'function') await WI.loadWorldInfo();
            return true;
        }
    } catch (e) {
        console.error("[CanonVoice] 写入异常:", e);
    }
    return false;
}

function triggerDownload(wbData, fileName) {
    const blob = new Blob([JSON.stringify(wbData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileName}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

async function initExtension() {
    try {
        $('#extensions_settings').append(extensionHtml);
        
        $('#cv_custom_url').val(localStorage.getItem('cv_custom_url') || '');
        $('#cv_custom_key').val(localStorage.getItem('cv_custom_key') || '');
        $('#cv_custom_model').val(localStorage.getItem('cv_custom_model') || '');

        $('#cv_process_btn').on('click', processSrtFile);
        $('#cv_refresh_wb_btn').on('click', async () => { await refreshWbDropdown(); toastr.success('列表已刷新'); });
        $('#cv_commit_btn').on('click', commitToWorldBook);
        $('#cv_undo_btn').on('click', undoCommit);

        setTimeout(refreshWbDropdown, 1200);

        // 【新增修复】读取浏览器记忆，按F5也能找回后悔药！
        if (sessionStorage.getItem('cv_show_undo') === 'true') {
            cv_backup_name = sessionStorage.getItem('cv_backup_name');
            try {
                cv_backup_data = JSON.parse(sessionStorage.getItem('cv_backup_data'));
                $('#cv_undo_btn').show();
            } catch (e) {
                console.error("恢复备份失败", e);
            }
        }

    } catch (e) {
        console.error("加载面板失败：", e);
    }
}

async function processSrtFile() {
    const charName = $('#cv_character_name').val().trim() || "全部登场角色";
    const episode = $('#cv_episode').val().trim() || "未知集数";
    const fileInput = document.getElementById('cv_srt_upload');
    
    localStorage.setItem('cv_custom_url', $('#cv_custom_url').val().trim());
    localStorage.setItem('cv_custom_key', $('#cv_custom_key').val().trim());
    localStorage.setItem('cv_custom_model', $('#cv_custom_model').val().trim());
    
    if (fileInput.files.length === 0) return toastr.warning('请先选择一个字幕文件！');

    const reader = new FileReader();
    reader.onload = async function(e) {
        const srtContent = e.target.result;
        let prompt = `${$('#cv_prompt_template').val().trim()}\n\n【集数】：${episode}\n`;
        prompt += charName === "全部登场角色" ? `【要求】：提取所有主要角色台词。\n` : `【目标角色】：仅提取【${charName}】的台词。\n`;
        prompt += `【原始字幕】(忽略代码只提取汉字)：\n${srtContent}`;

        $('#cv_result_preview').val("正在呼叫 AI，数据即将进入缓冲池，请耐心等待...");
        
        try {
            const customUrl = $('#cv_custom_url').val().trim();
            if (customUrl) {
                let endpoint = customUrl.endsWith('/chat/completions') ? customUrl : customUrl.replace(/\/$/, '') + '/chat/completions';
                const fetchRes = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${$('#cv_custom_key').val().trim()}` },
                    body: JSON.stringify({ model: $('#cv_custom_model').val().trim() || "gpt-3.5-turbo", messages: [{"role": "user", "content": prompt}], temperature: 0.1 })
                });
                if (!fetchRes.ok) throw new Error(`API 报错: ${fetchRes.status}`);
                const data = await fetchRes.json();
                $('#cv_result_preview').val(data.choices[0].message.content);
            } else {
                const currentApi = typeof MainScript.main_api !== 'undefined' ? MainScript.main_api : 'openai';
                $('#cv_result_preview').val(await MainScript.generateRaw(prompt, currentApi, true));
            }
            toastr.success('✅ 解析完成！已进入缓冲池。');
        } catch (error) {
            $('#cv_result_preview').val("解析失败：\n" + error);
        }
    };
    reader.readAsText(fileInput.files[0]);
}

async function commitToWorldBook() {
    const resultText = $('#cv_result_preview').val();
    if (!resultText || !resultText.includes('[')) return toastr.warning("缓冲池内没有有效的 JSON 台词！");

    try {
        const jsonStr = resultText.substring(resultText.indexOf('['), resultText.lastIndexOf(']') + 1);
        const lines = JSON.parse(jsonStr);
        const episode = $('#cv_episode').val().trim() || "未知集数";
        const selectedWb = $('#cv_wb_select').val();

        let targetName = selectedWb;
        let wbData = { entries: {}, name: "" };

        if (selectedWb === '__NEW__') {
            targetName = prompt("请输入新世界书的名称：", `【${$('#cv_character_name').val().trim() || "群像"}】原著台词库`);
            if (!targetName) return; 
            wbData.name = targetName;
        } else {
            // 获取旧数据
            wbData = await getWbData(selectedWb);
            if (!wbData.entries) wbData.entries = {};
        }

        // 备份数据用于撤回
        cv_backup_data = JSON.parse(JSON.stringify(wbData));
        cv_backup_name = targetName;

        // 场景去重聚合
        const sceneMap = {};
        lines.forEach(item => {
            const sceneName = item.scene;
            if (!sceneMap[sceneName]) sceneMap[sceneName] = { speakers: new Set(), dialogues: [] };
            sceneMap[sceneName].speakers.add(item.speaker);
            sceneMap[sceneName].dialogues.push(`[${item.speaker}] 说道：“${item.line.replace(/"/g, "'")}”`);
        });

        // 获取当前最大的 UID，并在其后顺延
        let nextUid = -1;
        Object.values(wbData.entries).forEach(e => {
            const u = parseInt(e.uid);
            if (!isNaN(u) && u > nextUid) nextUid = u;
        });
        nextUid++;

        let addedCount = 0;
        for (const [scene, data] of Object.entries(sceneMap)) {
            const keywords = Array.from(data.speakers).concat(scene.split(/[，。、\s]/).filter(k => k.length > 1));
            wbData.entries[nextUid.toString()] = {
                uid: nextUid,
                key: keywords, keysecondary: [],
                comment: `[${episode}] 场景：${scene.substring(0, 15)}...`,
                content: `[剧情引导：当前情境高度符合“${scene}”。以下为该场景下的原著台词参考，若剧情触发至此，请让角色自然地运用这些台词：\n${data.dialogues.join('\n')}]`,
                constant: false, vectorized: false, insertion_order: 50, position: 1, enabled: true
            };
            nextUid++;
            addedCount++;
        }

        toastr.info("正在直连追加到酒馆数据库...");
        const writeSuccess = await saveWbApi(targetName, wbData);
        
        if (writeSuccess) {
            toastr.success(`🎉 成功将 ${addedCount} 个场景追加到 [${targetName}]！`);
            $('#cv_undo_btn').show(); 
            
            // 【新增修复】把备份数据写进浏览器缓存，防刷新
            sessionStorage.setItem('cv_backup_data', JSON.stringify(cv_backup_data));
            sessionStorage.setItem('cv_backup_name', cv_backup_name);
            sessionStorage.setItem('cv_show_undo', 'true');

            // 【新增修复】强行触发UI重绘，不用再按 F5 了！
            if ($('#world_editor_select').val() === targetName) {
                $('#world_editor_select').trigger('change');
            }

            if (selectedWb === '__NEW__') await refreshWbDropdown();
        } else {
            toastr.warning(`⚠️ 直连写入未成功，已为您下载合并后的文件，可直接导入！`);
            triggerDownload(wbData, targetName);
        }
        
    } catch (e) {
        console.error(e);
        toastr.error("处理失败，请检查框内 JSON 格式是否完整！");
    }
}

async function undoCommit() {
    if (!cv_backup_data || !cv_backup_name) return toastr.warning("没有可撤销的记录！");
    
    if (confirm(`确定要撤回刚才对 [${cv_backup_name}] 的追加写入吗？\n撤回后将恢复到追加前的状态。`)) {
        
        // 深拷贝一份用来撤回，防止引用污染影响后续操作
        const rollbackData = JSON.parse(JSON.stringify(cv_backup_data));

        if (await saveWbApi(cv_backup_name, rollbackData)) {
            toastr.success(`↩️ 撤回成功，[${cv_backup_name}] 已恢复原状！`);
            $('#cv_undo_btn').hide(); 
            cv_backup_data = null;    

            // 【新增修复】撤销后清除记忆
            sessionStorage.removeItem('cv_backup_data');
            sessionStorage.removeItem('cv_backup_name');
            sessionStorage.removeItem('cv_show_undo');

            // 【新增修复】强行触发UI重绘，不用按 F5！
            if ($('#world_editor_select').val() === cv_backup_name) {
                $('#world_editor_select').trigger('change');
            }
        } else {
            toastr.error("撤回失败！");
        }
    }
}

jQuery(async () => {
    await initExtension();
});