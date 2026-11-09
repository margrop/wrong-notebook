/*
 * 每次页面加载完成后注入，补齐 WebView 不支持的浏览器能力：
 * - window.print()：交给系统打印（可另存为 PDF）
 * - <a download> 下载 blob:/data: 链接：分块写入原生临时文件，再由系统「另存为」保存
 *
 * 导出文件可能很大（含题目原图、云端语音），不再把整个文件转成 data URL 一次传给原生：
 * 原生逐块写入临时文件，保存对话框返回后直接复制到用户选择的位置，App 在对话框期间
 * 被系统回收也不会丢内容。保存结果由原生回调 __wrongNotebookOnSaveResult。
 */
(function () {
    if (window.__wrongNotebookAndroidReady) return;
    window.__wrongNotebookAndroidReady = true;
    var bridge = window.WrongNotebookAndroid;
    if (!bridge) return;

    window.print = function () {
        bridge.print();
    };

    // 页面通常在 click() 之后立即 revoke，延迟释放，保证下面的 fetch 能读到内容
    var revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = function (url) {
        setTimeout(function () { revoke(url); }, 60000);
    };

    // 每次跨 JS 桥传 128KB 原始数据（base64 约 174KB），避免大字符串复制与内存峰值
    var CHUNK_SIZE = 128 * 1024;
    var pendingSave = null;

    function toBase64(buffer) {
        var bytes = new Uint8Array(buffer);
        var binary = '';
        var step = 8192;
        for (var i = 0; i < bytes.length; i += step) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
        }
        return btoa(binary);
    }

    /** 把 Blob 分块交给原生写临时文件；原生保存完成后回调结果 */
    function saveBlob(blob, name) {
        return new Promise(function (resolve, reject) {
            if (pendingSave) {
                reject(new Error('A save is already in progress'));
                return;
            }
            pendingSave = { resolve: resolve, reject: reject };
            var failed = false;
            try {
                bridge.beginSaveFile(name || '', blob.type || '');
            } catch (error) {
                pendingSave = null;
                reject(error);
                return;
            }

            function fail(error) {
                if (failed) return;
                failed = true;
                var pending = pendingSave;
                pendingSave = null;
                try {
                    bridge.abortSaveFile();
                } catch (ignored) {
                    // 原生清理失败不掩盖原始错误
                }
                if (pending) pending.reject(error);
            }

            var offset = 0;
            function next() {
                if (offset >= blob.size) {
                    try {
                        bridge.endSaveFile();
                    } catch (error) {
                        fail(error);
                    }
                    return;
                }
                var slice = blob.slice(offset, Math.min(offset + CHUNK_SIZE, blob.size));
                offset += CHUNK_SIZE;
                slice.arrayBuffer()
                    .then(function (buffer) {
                        try {
                            bridge.appendSaveFileChunk(toBase64(buffer));
                            next();
                        } catch (error) {
                            fail(error);
                        }
                    })
                    .catch(fail);
            }
            next();
        });
    }

    /** 原生保存完成：saved=true 表示已写入文件；canceled=true 表示用户取消 */
    window.__wrongNotebookOnSaveResult = function (saved, canceled, message) {
        var pending = pendingSave;
        pendingSave = null;
        if (pending) {
            pending.resolve({ saved: !!saved, canceled: !!canceled, message: message || '' });
        }
    };

    function save(href, name) {
        return fetch(href, { credentials: 'same-origin' })
            .then(function (response) { return response.blob(); })
            .then(function (blob) { return saveBlob(blob, name); })
            .catch(function (error) {
                console.error('[WrongNotebookAndroid] download failed', error);
                throw error;
            });
    }

    /** 下载监听器与未接入 __wrongNotebookSaveAndWait 的页面使用 */
    window.__wrongNotebookSave = save;
    /** 网页直接拿到 Blob 时使用，省掉一次 fetch 与一份内存副本 */
    window.__wrongNotebookSaveAndWait = saveBlob;

    function isLocalDownload(anchor) {
        return !!anchor && anchor.hasAttribute('download') && /^(blob|data):/i.test(anchor.href);
    }

    // 脚本创建的链接常未插入文档就调用 click()，因此同时拦截原型方法和文档点击
    var click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
        if (isLocalDownload(this)) {
            save(this.href, this.getAttribute('download')).catch(function () {});
            return;
        }
        return click.call(this);
    };
    document.addEventListener('click', function (event) {
        var target = event.target;
        var anchor = target && target.closest ? target.closest('a') : null;
        if (isLocalDownload(anchor)) {
            event.preventDefault();
            save(anchor.href, anchor.getAttribute('download')).catch(function () {});
        }
    }, true);
})();
