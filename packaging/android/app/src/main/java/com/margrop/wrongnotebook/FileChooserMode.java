package com.margrop.wrongnotebook;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * 网页文件选择请求对应的系统入口，与 Android 接口无关，便于单独验证。
 *
 * - CAMERA：网页 input 带 capture（「拍照」按钮），直接打开相机；
 * - ALBUM：只接受 image/*（「相册」按钮），打开系统照片选择器；
 * - FILE：其他情况（「从文件选择」、拖拽区），打开文件选择器；不限类型时显示全部文件，
 *   作为相册中看不到照片（如部分系统把 HEIC 标成未知类型）时的兜底。
 */
final class FileChooserMode {
    enum Mode { CAMERA, ALBUM, FILE }

    /** 接受图片时额外列出的 HEIC/HEIF 类型：部分文件管理器按具体 MIME 过滤，image/* 不一定包含它们 */
    static final String[] HEIF_MIME_TYPES = { "image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence" };

    private FileChooserMode() {
    }

    private static List<String> normalize(String[] acceptTypes) {
        List<String> result = new ArrayList<>();
        if (acceptTypes == null) return result;
        for (String type : acceptTypes) {
            if (type == null) continue;
            for (String part : type.split(",")) {
                String value = part.trim().toLowerCase(Locale.ROOT);
                if (!value.isEmpty()) result.add(value);
            }
        }
        return result;
    }

    static boolean acceptsImages(String[] acceptTypes) {
        List<String> types = normalize(acceptTypes);
        if (types.isEmpty()) return true;
        for (String type : types) {
            if (type.startsWith("image/") || type.equals("*/*")
                    || type.matches("\\.(jpe?g|png|gif|webp|heic|heif|bmp)")) {
                return true;
            }
        }
        return false;
    }

    static Mode resolve(String[] acceptTypes, boolean captureEnabled) {
        if (captureEnabled && acceptsImages(acceptTypes)) return Mode.CAMERA;
        List<String> types = normalize(acceptTypes);
        if (!types.isEmpty()) {
            boolean onlyImageWildcard = true;
            for (String type : types) {
                if (!type.equals("image/*")) {
                    onlyImageWildcard = false;
                    break;
                }
            }
            if (onlyImageWildcard) return Mode.ALBUM;
        }
        return Mode.FILE;
    }

    /**
     * 文件选择器的 MIME 过滤：不限类型时返回空数组（显示全部文件）；接受图片时为 image/* 加 HEIC/HEIF；
     * 扩展名换成对应 MIME，无法换算的类型存在时不过滤，避免把可用文件藏起来。
     */
    static String[] fileMimeTypes(String[] acceptTypes) {
        List<String> types = normalize(acceptTypes);
        Set<String> mimes = new LinkedHashSet<>();
        for (String type : types) {
            if (type.equals("*/*")) return new String[0];
            if (type.contains("/")) {
                mimes.add(type);
            } else if (type.matches("\\.(jpe?g)")) {
                mimes.add("image/jpeg");
            } else if (type.matches("\\.(png|gif|webp|bmp)")) {
                mimes.add("image/" + type.substring(1));
            } else if (type.matches("\\.(heic|heif)")) {
                mimes.add("image/" + type.substring(1));
            } else {
                return new String[0];
            }
        }
        for (String mime : new ArrayList<>(mimes)) {
            if (mime.startsWith("image/")) {
                for (String heif : HEIF_MIME_TYPES) mimes.add(heif);
                break;
            }
        }
        return mimes.toArray(new String[0]);
    }
}
