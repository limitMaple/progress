
const withPWA = require('next-pwa')({
    dest: 'public', // Service Workerの出力先
    register: true, // Service Workerを自動で登録
    skipWaiting: true, // 新しいService Workerがすぐに有効になるようにする
    disable: process.env.NODE_ENV === 'development', // 開発時は無効にする
});

const nextConfig = {
    output: 'export', // 静的エクスポート
    // その他のNext.js設定
};

module.exports = withPWA(nextConfig);
export default nextConfig;
