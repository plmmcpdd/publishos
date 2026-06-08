const mockCustomers = [
  { id: 1, name: 'Cool Air HVAC', email: 'contact@coolair.com', plan: '基础版', status: 'active' },
  { id: 2, name: 'Super Cool Services', email: 'info@supercool.com', plan: '专业版', status: 'active' },
];

export default function CustomerList() {
  return (
    <div>
      <h3 className="text-lg font-medium mb-4">客户列表</h3>
      <div className="bg-white rounded-xl shadow-sm overflow-hidden">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">客户</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">邮箱</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">套餐</th>
              <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {mockCustomers.map((customer) => (
              <tr key={customer.id}>
                <td className="px-6 py-4 text-sm font-medium">{customer.name}</td>
                <td className="px-6 py-4 text-sm text-gray-500">{customer.email}</td>
                <td className="px-6 py-4 text-sm">
                  <span className="px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-xs">{customer.plan}</span>
                </td>
                <td className="px-6 py-4">
                  <span className="w-2 h-2 bg-green-500 rounded-full inline-block mr-2" />
                  {customer.status === 'active' ? '活跃' : '暂停'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
