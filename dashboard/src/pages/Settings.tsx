export default function Settings() {
  return (
    <div>
      <h3 className="text-lg font-medium mb-4">系统设置</h3>
      <div className="bg-white rounded-xl shadow-sm p-6 space-y-6">
        <div>
          <label className="block text-sm font-medium mb-2">系统名称</label>
          <input type="text" defaultValue="PublishOS" className="w-full px-4 py-2 border rounded-lg" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-2">通知邮箱</label>
          <input type="email" defaultValue="admin@publishos.com" className="w-full px-4 py-2 border rounded-lg" />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium">自动审核</p>
            <p className="text-sm text-gray-500">开启后低风险内容自动通过</p>
          </div>
          <button className="w-12 h-6 bg-blue-500 rounded-full relative">
            <span className="absolute right-1 top-1 w-4 h-4 bg-white rounded-full" />
          </button>
        </div>
        <button className="px-6 py-2 bg-brand-deepblue text-white rounded-lg hover:opacity-90">保存设置</button>
      </div>
    </div>
  );
}
