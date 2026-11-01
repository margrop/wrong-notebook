import type { NextConfig } from "next";

/**
 * 所有响应都带的安全头。
 * 不设置 HSTS（局域网常用 HTTP 访问），也不限制脚本来源（GeoGebra、KaTeX 等需要），
 * 只收紧不影响功能的部分：禁止被其他站点嵌入、禁止插件和改写 base/表单目标。
 */
export const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // 上传题目需要摄像头和屏幕截图，其余敏感能力一律关闭
  { key: "Permissions-Policy", value: "camera=(self), display-capture=(self), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" },
];

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  // 禁止 next dev 自动向 AGENTS.md / CLAUDE.md 写入 agent-rules 段落
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
