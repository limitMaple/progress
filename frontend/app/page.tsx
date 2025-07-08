export default function HomePage() {
  return (
      <div>
        <h2 className="text-3xl font-bold mb-6">ダッシュボード</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* カードのサンプル */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-semibold mb-2">今日のタスク</h3>
            <p className="text-gray-600 dark:text-gray-400">残りのタスク: 5件</p>
          </div>

          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-semibold mb-2">進捗タイマー</h3>
            <p className="text-gray-600 dark:text-gray-400">今日の集中時間: 45分</p>
          </div>

          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
            <h3 className="text-xl font-semibold mb-2">AIチャット</h3>
            <p className="text-gray-600 dark:text-gray-400">新しいアイデアを得よう！</p>
          </div>
        </div>
      </div>
  );
}
