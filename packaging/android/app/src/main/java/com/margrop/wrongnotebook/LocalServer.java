package com.margrop.wrongnotebook;

import android.content.Context;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.RandomAccessFile;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 单机版在手机上运行的错题本服务端。
 *
 * APK 内置 Node.js（jniLibs 中的 libnode.so）、Prisma 引擎和打包好的服务端（assets/server.zip）：
 *   1. 首次启动或升级后把 server.zip 解压到应用私有目录
 *   2. 用内置 Node.js 运行通用启动器 launcher.js：复制预置数据库、执行迁移、启动 Next.js 服务
 *   3. 服务只监听 127.0.0.1，WebView 通过 http://127.0.0.1:PORT 访问
 * 数据库和配置保存在应用私有目录 files/data，卸载应用时一并删除。
 */
final class LocalServer {
    static final int PORT = 38017;
    static final String URL = "http://127.0.0.1:" + PORT;

    private static final long START_TIMEOUT_MS = 180_000;
    private static final int LOG_TAIL_BYTES = 4096;

    /** 启动进度，用于在界面上显示当前步骤 */
    interface Listener {
        void onStep(int messageRes);
    }

    private LocalServer() {
    }

    /** 确保服务在运行；耗时操作（解压、迁移、启动），必须在后台线程调用 */
    static synchronized void ensureRunning(Context context, Listener listener) throws IOException {
        JSONObject runtime = readRuntimeInfo(context);
        String version = runtime.optString("version");
        if (version.equals(healthyVersion())) return;

        File filesDir = context.getFilesDir();
        File serverDir = new File(filesDir, "server");
        File dataDir = new File(filesDir, "data");
        File logDir = new File(dataDir, "logs");
        File tmpDir = new File(context.getCacheDir(), "node-tmp");
        File pidFile = new File(filesDir, "server.pid");
        for (File dir : new File[]{dataDir, logDir, tmpDir}) {
            if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("Cannot create " + dir);
        }

        stopStale(pidFile);
        String serverSha256 = runtime.optString("serverSha256");
        File marker = new File(serverDir, ".installed");
        if (!serverSha256.equals(readText(marker))) {
            listener.onStep(R.string.starting_unpack);
            installServer(context, serverDir, marker, serverSha256);
        }

        listener.onStep(R.string.starting_server);
        String nativeDir = context.getApplicationInfo().nativeLibraryDir;
        File log = new File(logDir, "server.log");
        File previousLog = new File(logDir, "server.log.1");
        if (log.exists() && !log.renameTo(previousLog)) //noinspection ResultOfMethodCallIgnored
            log.delete();

        // 通过 sh 记录进程号后 exec 成 node，下次启动时据此结束残留进程
        String command = "echo $$ > \"$WN_PID_FILE\"; exec \"$WN_NODE\" \"$WN_LAUNCHER\""
                + " --host 127.0.0.1 --port " + PORT + " --data-dir \"$WN_DATA\"";
        ProcessBuilder builder = new ProcessBuilder("/system/bin/sh", "-c", command)
                .directory(serverDir)
                .redirectErrorStream(true)
                .redirectOutput(log);
        Map<String, String> env = builder.environment();
        env.put("WN_PID_FILE", pidFile.getAbsolutePath());
        env.put("WN_NODE", nativeDir + "/libnode.so");
        env.put("WN_LAUNCHER", new File(serverDir, "launcher.js").getAbsolutePath());
        env.put("WN_DATA", dataDir.getAbsolutePath());
        env.put("LD_LIBRARY_PATH", nativeDir);
        env.put("HOME", filesDir.getAbsolutePath());
        env.put("TMPDIR", tmpDir.getAbsolutePath());
        // 内置 Node.js 来自 Termux，默认读取 Termux 目录下的证书，改用 Node.js 自带的根证书访问 AI 服务
        env.put("NODE_OPTIONS", "--use-bundled-ca");
        env.put("PRISMA_QUERY_ENGINE_LIBRARY", nativeDir + "/libquery_engine.so");
        env.put("PRISMA_SCHEMA_ENGINE_BINARY", nativeDir + "/libschema_engine.so");
        env.put("APP_VERSION", version);
        Process process = builder.start();

        long deadline = System.currentTimeMillis() + START_TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            if (!isAlive(process)) {
                throw new IOException("Server exited (" + process.exitValue() + ")\n" + tail(log));
            }
            if (healthyVersion() != null) return;
            try {
                Thread.sleep(300);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Interrupted", e);
            }
        }
        process.destroy();
        throw new IOException("Server start timed out\n" + tail(log));
    }

    /**
     * 打开应用时加载的地址：全新安装还没有管理员时，服务端在配置目录写入一次性初始化令牌，
     * 直接打开初始化页设置管理员账号；创建管理员后令牌被删除，回到首页
     */
    static String startUrl(Context context) {
        String token = readText(new File(context.getFilesDir(), "data/config/setup-token")).trim();
        // 令牌为 base64url 字符，其他内容视为无效，不拼进地址
        if (!token.matches("[A-Za-z0-9_-]{16,128}")) return URL;
        return URL + "/initialize?token=" + token;
    }

    /** 服务正常时返回其版本号，否则返回 null */
    static String healthyVersion() {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(URL + "/api/health").openConnection();
            connection.setConnectTimeout(1000);
            connection.setReadTimeout(2000);
            if (connection.getResponseCode() != 200) return null;
            try (InputStream in = connection.getInputStream()) {
                return new JSONObject(readStream(in)).optString("version", "");
            }
        } catch (IOException | JSONException e) {
            return null;
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private static JSONObject readRuntimeInfo(Context context) throws IOException {
        try (InputStream in = context.getAssets().open("runtime.json")) {
            return new JSONObject(readStream(in));
        } catch (JSONException e) {
            throw new IOException("Invalid runtime.json", e);
        }
    }

    /** 上次运行留下、但版本不符或已无响应的服务进程 */
    private static void stopStale(File pidFile) {
        String text = readText(pidFile);
        if (text.isEmpty()) return;
        try {
            int pid = Integer.parseInt(text.trim());
            String cmdline = readText(new File("/proc/" + pid + "/cmdline"));
            if (cmdline.contains("libnode.so")) android.os.Process.killProcess(pid);
        } catch (NumberFormatException ignored) {
            // 进程号文件损坏时忽略
        }
        //noinspection ResultOfMethodCallIgnored
        pidFile.delete();
    }

    private static void installServer(Context context, File serverDir, File marker, String sha256) throws IOException {
        File staging = new File(serverDir.getParentFile(), "server.new");
        deleteRecursively(staging);
        deleteRecursively(serverDir);
        String root = staging.getCanonicalPath() + File.separator;
        byte[] buffer = new byte[64 * 1024];
        try (ZipInputStream zip = new ZipInputStream(context.getAssets().open("server.zip"))) {
            ZipEntry entry;
            while ((entry = zip.getNextEntry()) != null) {
                File target = new File(staging, entry.getName());
                if (!target.getCanonicalPath().startsWith(root)) throw new IOException("Bad entry " + entry.getName());
                if (entry.isDirectory()) {
                    if (!target.isDirectory() && !target.mkdirs()) throw new IOException("Cannot create " + target);
                    continue;
                }
                File parent = target.getParentFile();
                if (parent != null && !parent.isDirectory() && !parent.mkdirs()) throw new IOException("Cannot create " + parent);
                try (OutputStream out = new FileOutputStream(target)) {
                    int read;
                    while ((read = zip.read(buffer)) != -1) out.write(buffer, 0, read);
                }
            }
        }
        if (!staging.renameTo(serverDir)) throw new IOException("Cannot install server");
        Files.write(marker.toPath(), sha256.getBytes(StandardCharsets.UTF_8));
    }

    private static boolean isAlive(Process process) {
        try {
            process.exitValue();
            return false;
        } catch (IllegalThreadStateException e) {
            return true;
        }
    }

    private static String tail(File file) {
        try (RandomAccessFile raf = new RandomAccessFile(file, "r")) {
            long start = Math.max(0, raf.length() - LOG_TAIL_BYTES);
            byte[] bytes = new byte[(int) (raf.length() - start)];
            raf.seek(start);
            raf.readFully(bytes);
            return new String(bytes, StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    private static String readText(File file) {
        try {
            return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
        } catch (IOException e) {
            return "";
        }
    }

    private static String readStream(InputStream in) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int read;
        while ((read = in.read(buffer)) != -1) out.write(buffer, 0, read);
        return out.toString(StandardCharsets.UTF_8.name());
    }

    private static void deleteRecursively(File file) {
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) deleteRecursively(child);
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
