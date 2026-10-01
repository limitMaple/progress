import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 静的なファイルとして書き出して Firebase Hosting に置く（サーバー処理は Cloud Functions 側）
  output: "export",
};

export default nextConfig;
