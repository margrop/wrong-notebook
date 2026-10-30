package com.margrop.wrongnotebook;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
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
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URLDecoder;
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
    private byte[] pendingFile;

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

    private void startSave(String dataUrl, String fileName, String mimeType) {
        int comma = dataUrl.indexOf(',');
        if (!dataUrl.startsWith("data:") || comma < 0) {
            Toast.makeText(this, R.string.file_save_failed, Toast.LENGTH_SHORT).show();
            return;
        }
        String header = dataUrl.substring(0, comma);
        String payload = dataUrl.substring(comma + 1);
        try {
            pendingFile = header.endsWith(";base64")
                    ? Base64.decode(payload, Base64.DEFAULT)
                    : URLDecoder.decode(payload, StandardCharsets.UTF_8.name()).getBytes(StandardCharsets.UTF_8);
        } catch (IllegalArgumentException | IOException e) {
            Toast.makeText(this, R.string.file_save_failed, Toast.LENGTH_SHORT).show();
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(mimeType == null || mimeType.isEmpty() ? "application/octet-stream" : mimeType);
        intent.putExtra(Intent.EXTRA_TITLE, fileName == null || fileName.isEmpty() ? "download" : fileName);
        try {
            startActivityForResult(intent, REQUEST_SAVE_FILE);
        } catch (ActivityNotFoundException e) {
            pendingFile = null;
            Toast.makeText(this, R.string.no_app_for_action, Toast.LENGTH_SHORT).show();
        }
    }

    private void writePendingFile(Uri uri) {
        byte[] data = pendingFile;
        pendingFile = null;
        if (data == null) return;
        executor.execute(() -> {
            boolean ok;
            try (OutputStream out = getContentResolver().openOutputStream(uri)) {
                if (out == null) throw new IOException("Cannot open " + uri);
                out.write(data);
                ok = true;
            } catch (IOException e) {
                ok = false;
            }
            boolean saved = ok;
            runOnUiThread(() -> Toast.makeText(this,
                    saved ? R.string.file_saved : R.string.file_save_failed, Toast.LENGTH_SHORT).show());
        });
    }

    // ---------- 选择图片 / 拍照上传 ----------

    private boolean acceptsImages(WebChromeClient.FileChooserParams params) {
        String[] types = params.getAcceptTypes();
        if (types == null || types.length == 0) return true;
        for (String type : types) {
            String t = type == null ? "" : type.trim().toLowerCase();
            if (t.isEmpty() || t.startsWith("image/") || t.equals("*/*")
                    || t.matches("\\.(jpe?g|png|gif|webp|heic|heif|bmp)")) {
                return true;
            }
        }
        return false;
    }

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

    private boolean openFileChooser(ValueCallback<Uri[]> callback, WebChromeClient.FileChooserParams params) {
        if (fileCallback != null) fileCallback.onReceiveValue(null);
        fileCallback = callback;
        cameraFile = null;
        cameraUri = null;

        Intent content = params.createIntent();
        if (params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE) {
            content.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        Intent camera = acceptsImages(params) ? createCameraIntent() : null;

        Intent chooser;
        if (camera != null && params.isCaptureEnabled()) {
            chooser = camera;
        } else {
            chooser = Intent.createChooser(content, null);
            if (camera != null) chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{camera});
        }
        try {
            startActivityForResult(chooser, REQUEST_FILE_CHOOSER);
        } catch (ActivityNotFoundException e) {
            fileCallback.onReceiveValue(null);
            fileCallback = null;
            Toast.makeText(this, R.string.no_app_for_action, Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    private Uri[] parseChooserResult(int resultCode, Intent data) {
        if (resultCode != RESULT_OK) return null;
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
        // 相机直接写入 EXTRA_OUTPUT，返回的 Intent 不带数据
        if (cameraFile != null && cameraFile.length() > 0) return new Uri[]{cameraUri};
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
                pendingFile = null;
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
            errorView.setVisibility(View.GONE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            view.evaluateJavascript(bridgeScript, null);
            CookieManager.getInstance().flush();
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
        public void saveFile(String dataUrl, String fileName, String mimeType) {
            runForTrustedPage(() -> startSave(dataUrl, fileName, mimeType));
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
