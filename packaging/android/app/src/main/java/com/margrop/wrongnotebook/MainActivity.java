package com.margrop.wrongnotebook;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 用 WebView 打开错题本，并补齐拍照上传、文件下载、打印等原生能力。
 * 单机版打开本机内置的服务端（见 LocalServer），客户端版打开用户配置的服务器。
 */
public class MainActivity extends Activity {
    private static final int REQUEST_FILE_CHOOSER = 1;
    private static final int REQUEST_SAVE_FILE = 2;
    private static final String BRIDGE_NAME = "WrongNotebookAndroid";
    private static final String KEY_SAVE_NAME = "pendingSaveName";
    private static final String KEY_SAVE_MIME = "pendingSaveMime";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    /** 本次运行中用户已确认信任的证书（主机 + 证书信息） */
    private final Set<String> trustedCertificates = new HashSet<>();

    private String serverUrl;
    private String bridgeScript;
    private WebView webView;
    private ProgressBar progress;
    private View errorView;
    private TextView errorTitle;
    private TextView errorMessage;
    private View startingView;
    private TextView startingMessage;
    /** 单机版内置服务端正在启动 */
    private boolean starting;

    private ValueCallback<Uri[]> fileCallback;
    private File cameraFile;
    private Uri cameraUri;
    /** 原生「另存为」待写入的临时文件；文件保存在应用目录，对话框期间进程被回收也不丢 */
    private File pendingSaveFile;
    private String pendingSaveName;
    private String pendingSaveMime;
    private FileOutputStream pendingSaveStream;
    private boolean pendingSaveFailed;
    /** 页面已完成加载并注入 Bridge，可以回调保存结果 */
    private boolean pageReady;
    /** 保存结果先缓存，页面重新加载时在 onPageFinished 补发 */
    private String[] pendingSaveResult;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        serverUrl = BuildConfig.STANDALONE ? LocalServer.URL : ServerConfig.get(this);
        if (serverUrl == null) {
            openSetup();
            finish();
            return;
        }

        setContentView(R.layout.activity_main);
        SystemBars.applyInsets(findViewById(R.id.root));
        webView = findViewById(R.id.web_view);
        progress = findViewById(R.id.progress);
        errorView = findViewById(R.id.error_view);
        errorTitle = findViewById(R.id.error_title);
        errorMessage = findViewById(R.id.error_message);
        startingView = findViewById(R.id.starting_view);
        startingMessage = findViewById(R.id.starting_message);
        bridgeScript = readAsset("bridge.js");

        // 系统「另存为」对话框期间 Activity 可能被回收；从固定的临时文件恢复待保存内容
        File pending = pendingSaveTempFile();
        if (pending.isFile()) {
            pendingSaveFile = pending;
            if (savedInstanceState != null) {
                pendingSaveName = savedInstanceState.getString(KEY_SAVE_NAME);
                pendingSaveMime = savedInstanceState.getString(KEY_SAVE_MIME);
            }
        }

        findViewById(R.id.retry).setOnClickListener(v -> {
            errorView.setVisibility(View.GONE);
            if (BuildConfig.STANDALONE) {
                startLocalServer(true);
            } else {
                webView.reload();
            }
        });
        View changeServer = findViewById(R.id.change_server);
        if (BuildConfig.STANDALONE) {
            errorTitle.setText(R.string.error_local_title);
            changeServer.setVisibility(View.GONE);
        } else {
            changeServer.setOnClickListener(v -> openSetup());
        }

        configureWebView();
        boolean restored = savedInstanceState != null && webView.restoreState(savedInstanceState) != null;
        if (BuildConfig.STANDALONE) {
            startLocalServer(!restored);
        } else if (!restored) {
            webView.loadUrl(serverUrl);
        }
    }

    /**
     * 启动或复用本机服务端，就绪后按需加载页面。
     * 应用在后台时系统可能结束服务端进程，回到前台时也会经过这里重新拉起。
     */
    private void startLocalServer(boolean load) {
        if (starting) return;
        starting = true;
        startingMessage.setText(R.string.starting_server);
        startingView.setVisibility(View.VISIBLE);
        executor.execute(() -> {
            String failure = null;
            try {
                LocalServer.ensureRunning(this, messageRes -> runOnUiThread(() -> startingMessage.setText(messageRes)));
            } catch (IOException e) {
                failure = e.getMessage();
            }
            String error = failure;
            runOnUiThread(() -> {
                starting = false;
                if (isFinishing() || isDestroyed()) return;
                startingView.setVisibility(View.GONE);
                if (error != null) {
                    showError(error);
                } else if (load) {
                    webView.loadUrl(LocalServer.startUrl(this));
                }
            });
        });
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        // 网页可据此识别安卓客户端，显示「更换服务器」等入口
        settings.setUserAgentString(settings.getUserAgentString()
                + " WrongNotebookAndroid/" + BuildConfig.VERSION_NAME + " (" + BuildConfig.DEVICE_TYPE + ")");

        CookieManager.getInstance().setAcceptCookie(true);
        webView.addJavascriptInterface(new Bridge(), BRIDGE_NAME);
        webView.setWebViewClient(new Client());
        webView.setWebChromeClient(new ChromeClient());
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            webView.evaluateJavascript("window.__wrongNotebookSave && window.__wrongNotebookSave("
                    + JSONObject.quote(url) + "," + JSONObject.quote(name) + ")", null);
        });
        if (BuildConfig.DEBUG) WebView.setWebContentsDebuggingEnabled(true);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (webView != null) webView.saveState(outState);
        outState.putString(KEY_SAVE_NAME, pendingSaveName);
        outState.putString(KEY_SAVE_MIME, pendingSaveMime);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView == null) return;
        webView.onResume();
        if (BuildConfig.STANDALONE && !starting) {
            // 服务端进程被系统回收后重新启动并刷新页面
            executor.execute(() -> {
                if (LocalServer.healthyVersion() == null) runOnUiThread(() -> startLocalServer(true));
            });
        }
    }

    @Override
    protected void onPause() {
        // 及时落盘登录 Cookie，避免被系统回收后需要重新登录
        CookieManager.getInstance().flush();
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        closePendingSaveStream();
        executor.shutdown();
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView != null && errorView.getVisibility() != View.VISIBLE && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    private void openSetup() {
        startActivity(new Intent(this, SetupActivity.class));
    }

    private void openExternal(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app_for_action, Toast.LENGTH_SHORT).show();
        }
    }

    private void showError(String description) {
        errorMessage.setText(BuildConfig.STANDALONE ? description : serverUrl + "\n" + description);
        errorView.setVisibility(View.VISIBLE);
        progress.setVisibility(View.GONE);
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[4096];
            int read;
            while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toString(StandardCharsets.UTF_8.name());
        } catch (IOException e) {
            throw new IllegalStateException("Missing asset " + name, e);
        }
    }

    // ---------- 打印 ----------

    private void printPage() {
        PrintManager printManager = (PrintManager) getSystemService(PRINT_SERVICE);
        String title = webView.getTitle() == null ? getString(R.string.app_name) : webView.getTitle();
        printManager.print(title, webView.createPrintDocumentAdapter(title), new PrintAttributes.Builder().build());
    }

    // ---------- 保存网页生成的文件（导出备份、试卷等） ----------

    /** 待保存内容固定写到应用目录的 pending.tmp；对话框返回后复制到用户选择的位置 */
    private File pendingSaveTempFile() {
        return new File(new File(getFilesDir(), "exports"), "pending.tmp");
    }

    /** 网页分块传来的文件内容写到临时文件，避免整份文件以 data URL 跨 JS 桥与驻留内存 */
    private synchronized void beginSaveTransfer(String fileName, String mimeType) {
        closePendingSaveStream();
        pendingSaveFile = null;
        pendingSaveName = fileName;
        pendingSaveMime = mimeType;
        pendingSaveFailed = false;

        File dir = getFilesDir();
        File exports = new File(dir, "exports");
        if (!exports.isDirectory() && !exports.mkdirs()) {
            pendingSaveFailed = true;
            return;
        }
        File file = pendingSaveTempFile();
        //noinspection ResultOfMethodCallIgnored
        file.delete();
        try {
            pendingSaveStream = new FileOutputStream(file);
            pendingSaveFile = file;
        } catch (IOException e) {
            pendingSaveFailed = true;
        }
    }

    private synchronized void appendSaveChunk(String base64) {
        if (pendingSaveFailed || pendingSaveStream == null) return;
        try {
            pendingSaveStream.write(Base64.decode(base64, Base64.DEFAULT));
        } catch (IllegalArgumentException | IOException e) {
            pendingSaveFailed = true;
        }
    }

    private synchronized void finishSaveTransfer() {
        closePendingSaveStream();
        boolean failed = pendingSaveFailed;
        File file = pendingSaveFile;
        String name = pendingSaveName;
        String mime = pendingSaveMime;
        runForTrustedPage(() -> startSave(file, name, mime, failed));
    }

    private synchronized void abortSaveTransfer() {
        closePendingSaveStream();
        File file = pendingSaveFile;
        pendingSaveFile = null;
        if (file != null) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
        }
    }

    private synchronized void closePendingSaveStream() {
        if (pendingSaveStream == null) return;
        try {
            pendingSaveStream.close();
        } catch (IOException ignored) {
            // 关闭失败时保留已写入的内容，后续复制仍可读取
        }
        pendingSaveStream = null;
    }

    private void startSave(File file, String fileName, String mimeType, boolean failed) {
        if (failed || file == null || !file.isFile()) {
            if (file != null) {
                //noinspection ResultOfMethodCallIgnored
                file.delete();
            }
            pendingSaveFile = null;
            Toast.makeText(this, R.string.file_save_failed, Toast.LENGTH_SHORT).show();
            finishSaveResult(false, false, getString(R.string.file_save_failed));
            return;
        }

        pendingSaveFile = file;
        pendingSaveName = fileName;
        pendingSaveMime = mimeType;
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // Blob 类型可能带 charset 参数（如 application/json; charset=utf-8），DocumentsUI 只认纯 MIME
        String type = mimeType == null ? "" : mimeType.split(";")[0].trim();
        intent.setType(type.isEmpty() ? "application/octet-stream" : type);
        intent.putExtra(Intent.EXTRA_TITLE, fileName == null || fileName.isEmpty() ? "download" : fileName);
        try {
            startActivityForResult(intent, REQUEST_SAVE_FILE);
        } catch (ActivityNotFoundException e) {
            //noinspection ResultOfMethodCallIgnored
            file.delete();
            pendingSaveFile = null;
            Toast.makeText(this, R.string.no_app_for_action, Toast.LENGTH_SHORT).show();
            finishSaveResult(false, false, getString(R.string.no_app_for_action));
        }
    }

    private void writePendingFile(Uri uri) {
        File source = pendingSaveFile;
        pendingSaveFile = null;
        String name = pendingSaveName;
        if (source == null || !source.isFile()) {
            Toast.makeText(this, R.string.file_save_failed, Toast.LENGTH_SHORT).show();
            finishSaveResult(false, false, getString(R.string.file_save_failed));
            return;
        }
        executor.execute(() -> {
            boolean ok;
            try (InputStream in = new FileInputStream(source);
                 OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("Cannot open " + uri);
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
                ok = true;
            } catch (IOException e) {
                ok = false;
            }
            //noinspection ResultOfMethodCallIgnored
            source.delete();
            boolean saved = ok;
            runOnUiThread(() -> {
                if (saved) {
                    String label = saveDisplayName(uri, name);
                    Toast.makeText(this, getString(R.string.file_saved_to, label), Toast.LENGTH_LONG).show();
                    finishSaveResult(true, false, label);
                } else {
                    Toast.makeText(this, R.string.file_save_failed, Toast.LENGTH_SHORT).show();
                    finishSaveResult(false, false, getString(R.string.file_save_failed));
                }
            });
        });
    }

    /** 读取用户选择文件的显示名，用于「已保存到 …」提示；取不到时回退到导出文件名 */
    private String saveDisplayName(Uri uri, String fallback) {
        try (Cursor cursor = getContentResolver().query(
                uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                String value = cursor.getString(0);
                if (value != null && !value.isEmpty()) return value;
            }
        } catch (RuntimeException ignored) {
            // 某些提供方不支持查询显示名
        }
        return fallback == null || fallback.isEmpty() ? uri.toString() : fallback;
    }

    /** 保存结果先缓存；页面未加载完成时由 onPageFinished 补发，避免 Activity 重建后丢回调 */
    private void finishSaveResult(boolean saved, boolean canceled, String message) {
        pendingSaveResult = new String[]{saved ? "1" : "0", canceled ? "1" : "0", message};
        runOnUiThread(this::deliverSaveResult);
    }

    private void deliverSaveResult() {
        if (pendingSaveResult == null || webView == null || !pageReady) return;
        String[] result = pendingSaveResult;
        pendingSaveResult = null;
        webView.evaluateJavascript("window.__wrongNotebookOnSaveResult && window.__wrongNotebookOnSaveResult("
                + result[0] + "," + result[1] + "," + JSONObject.quote(result[2]) + ")", null);
    }

    // ---------- 选择图片 / 拍照上传 ----------

    private Intent createCameraIntent() {
        File dir = new File(getCacheDir(), "camera");
        if (!dir.isDirectory() && !dir.mkdirs()) return null;
        File[] old = dir.listFiles();
        if (old != null) {
            for (File file : old) //noinspection ResultOfMethodCallIgnored
                file.delete();
        }
        cameraFile = new File(dir, "photo-" + System.currentTimeMillis() + ".jpg");
        cameraUri = FileProvider.getUriForFile(this, getPackageName() + ".files", cameraFile);
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, cameraUri);
        intent.setClipData(ClipData.newRawUri("", cameraUri));
        intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return intent;
    }

    /** 相册：Android 13 起使用系统照片选择器（无需存储权限），更早版本打开图库应用 */
    private Intent createAlbumIntent(boolean multiple) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= 33) {
            intent = new Intent(MediaStore.ACTION_PICK_IMAGES);
            intent.setType("image/*");
            if (multiple) intent.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, MediaStore.getPickImagesMaxLimit());
        } else {
            intent = new Intent(Intent.ACTION_PICK);
            intent.setDataAndType(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, "image/*");
            if (multiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        return intent;
    }

    /** 文件：系统文件选择器；不限类型时列出全部文件，接受图片时附带 HEIC/HEIF 类型 */
    private Intent createFileIntent(String[] acceptTypes, boolean multiple) {
        Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        String[] mimes = FileChooserMode.fileMimeTypes(acceptTypes);
        intent.setType(mimes.length == 1 ? mimes[0] : "*/*");
        if (mimes.length > 1) intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes);
        if (multiple) intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        return Intent.createChooser(intent, null);
    }

    private void cancelChooser(int message) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = null;
        Toast.makeText(this, message, Toast.LENGTH_LONG).show();
    }

    /**
     * 网页的拍照、相册、从文件选择三个入口分别打开相机、照片选择器和文件选择器。
     * 拍照只调用系统相机应用（ACTION_IMAGE_CAPTURE），不需要相机权限；相机不可用时提示改用相册或文件。
     */
    private boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        cameraFile = null;
        cameraUri = null;

        String[] acceptTypes = params.getAcceptTypes();
        boolean multiple = params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE;
        FileChooserMode.Mode mode = FileChooserMode.resolve(acceptTypes, params.isCaptureEnabled());

        if (mode == FileChooserMode.Mode.CAMERA) {
            Intent camera = createCameraIntent();
            if (camera == null) {
                cancelChooser(R.string.camera_unavailable);
                return true;
            }
            try {
                startActivityForResult(camera, REQUEST_FILE_CHOOSER);
            } catch (ActivityNotFoundException | SecurityException e) {
                cameraFile = null;
                cameraUri = null;
                cancelChooser(R.string.camera_unavailable);
            }
            return true;
        }

        Intent intent = mode == FileChooserMode.Mode.ALBUM ? createAlbumIntent(multiple) : createFileIntent(acceptTypes, multiple);
        try {
            startActivityForResult(intent, REQUEST_FILE_CHOOSER);
        } catch (ActivityNotFoundException e) {
            // 没有照片选择器或图库应用时退回文件选择器
            try {
                startActivityForResult(createFileIntent(acceptTypes, multiple), REQUEST_FILE_CHOOSER);
            } catch (ActivityNotFoundException fallback) {
                cancelChooser(R.string.no_app_for_action);
            }
        }
        return true;
    }

    private Uri[] parseChooserResult(int resultCode, Intent data) {
        if (resultCode != RESULT_OK) return null;
        // 拍照：相机直接写入 EXTRA_OUTPUT 指定的文件；取消或未写入时文件为空，不返回空文件
        if (cameraFile != null) return cameraFile.length() > 0 ? new Uri[]{cameraUri} : null;
        ClipData clip = data == null ? null : data.getClipData();
        if (clip != null && clip.getItemCount() > 0) {
            List<Uri> uris = new ArrayList<>();
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri uri = clip.getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
            if (!uris.isEmpty()) return uris.toArray(new Uri[0]);
        }
        if (data != null && data.getData() != null) return new Uri[]{data.getData()};
        return null;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQUEST_FILE_CHOOSER) {
            if (fileCallback != null) fileCallback.onReceiveValue(parseChooserResult(resultCode, data));
            fileCallback = null;
            return;
        }
        if (requestCode == REQUEST_SAVE_FILE) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                writePendingFile(data.getData());
            } else {
                File source = pendingSaveFile;
                pendingSaveFile = null;
                if (source != null) {
                    //noinspection ResultOfMethodCallIgnored
                    source.delete();
                }
                Toast.makeText(this, R.string.file_save_canceled, Toast.LENGTH_SHORT).show();
                finishSaveResult(false, true, getString(R.string.file_save_canceled));
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ---------- WebView 回调 ----------

    private final class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri url = request.getUrl();
            if (!request.isForMainFrame() || ServerConfig.isSameOrigin(url, serverUrl)) return false;
            // 外部链接（项目主页、AI 服务商控制台、mailto 等）交给系统打开
            openExternal(url);
            return true;
        }

        @Override
        public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
            pageReady = false;
            errorView.setVisibility(View.GONE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            view.evaluateJavascript(bridgeScript, null);
            pageReady = true;
            CookieManager.getInstance().flush();
            deliverSaveResult();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (!request.isForMainFrame()) return;
            String description = String.valueOf(error.getDescription());
            if (!BuildConfig.STANDALONE) {
                showError(description);
                return;
            }
            // 本机服务端不可用（如进程被系统结束）时重新启动；服务正常仍出错则显示错误，避免反复重试
            executor.execute(() -> {
                boolean healthy = LocalServer.healthyVersion() != null;
                runOnUiThread(() -> {
                    if (healthy) {
                        showError(description);
                    } else {
                        startLocalServer(true);
                    }
                });
            });
        }

        @Override
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            Uri url = Uri.parse(error.getUrl());
            String key = url.getHost() + "\n" + error.getCertificate();
            if (trustedCertificates.contains(key)) {
                handler.proceed();
                return;
            }
            // 局域网部署常用自签名证书，由用户确认后在本次运行中信任
            new AlertDialog.Builder(MainActivity.this)
                    .setTitle(R.string.ssl_title)
                    .setMessage(getString(R.string.ssl_message, url.getHost()))
                    .setCancelable(false)
                    .setPositiveButton(R.string.ssl_continue, (dialog, which) -> {
                        trustedCertificates.add(key);
                        handler.proceed();
                    })
                    .setNegativeButton(R.string.cancel, (dialog, which) -> {
                        handler.cancel();
                        showError(getString(R.string.ssl_title));
                    })
                    .show();
        }
    }

    private final class ChromeClient extends WebChromeClient {
        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            progress.setProgress(newProgress);
            progress.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            return openFileChooser(callback, params);
        }
    }

    /** 暴露给网页的接口，网页通过 window.WrongNotebookAndroid 调用 */
    /** 当前页面是否来自错题本服务器；Bridge 只为它执行操作，避免其他来源的页面调用 */
    private boolean isTrustedPage() {
        String url = webView == null ? null : webView.getUrl();
        return url != null && ServerConfig.isSameOrigin(Uri.parse(url), serverUrl);
    }

    /** 在主线程上、确认页面来源后执行 Bridge 请求 */
    private void runForTrustedPage(Runnable action) {
        runOnUiThread(() -> {
            if (isTrustedPage()) action.run();
        });
    }

    private final class Bridge {
        @JavascriptInterface
        public void changeServer() {
            if (!BuildConfig.STANDALONE) runForTrustedPage(MainActivity.this::openSetup);
        }

        @JavascriptInterface
        public void print() {
            runForTrustedPage(MainActivity.this::printPage);
        }

        @JavascriptInterface
        public void beginSaveFile(String fileName, String mimeType) {
            beginSaveTransfer(fileName, mimeType);
        }

        @JavascriptInterface
        public void appendSaveFileChunk(String base64) {
            appendSaveChunk(base64);
        }

        @JavascriptInterface
        public void endSaveFile() {
            finishSaveTransfer();
        }

        @JavascriptInterface
        public void abortSaveFile() {
            abortSaveTransfer();
        }

        @JavascriptInterface
        public String getServerUrl() {
            return serverUrl;
        }

        @JavascriptInterface
        public String getDeviceType() {
            return BuildConfig.DEVICE_TYPE;
        }

        @JavascriptInterface
        public boolean isStandalone() {
            return BuildConfig.STANDALONE;
        }
    }
}
