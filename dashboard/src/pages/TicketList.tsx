import { useEffect, useState } from 'react';
import { request } from '../api';

interface Ticket {
  id: string;
  companyName: string;
  address: string;
  website?: string;
  industry: string;
  status: string;
  priority: string;
  createdAt: string;
  photos: any[];
  diagnosis?: { somScore?: number; status: string } | null;
}

const statusLabel: Record<string, string> = {
  pending: '待诊断',
  diagnosing: '诊断中',
  completed: '报告已完成',
  delivered: '已交付',
};

const statusColor: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  diagnosing: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  delivered: 'bg-gray-100 text-gray-600',
};

export default function TicketList() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    companyName: '', address: '', website: '', industry: 'HVAC',
    phone: '', painPoints: '', contactName: '', contactEmail: '', contactPhone: '',
  });

  const loadTickets = async () => {
    setLoading(true);
    try {
      const url = filter === 'all' ? '/tickets' : `/tickets?status=${filter}`;
      const data = await request<{ success: boolean; data: Ticket[] }>(url);
      setTickets(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTickets(); }, [filter]);

  const handleCreate = async () => {
    if (!form.companyName || !form.address) return;
    try {
      await request('/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      setShowCreate(false);
      setForm({ companyName: '', address: '', website: '', industry: 'HVAC', phone: '', painPoints: '', contactName: '', contactEmail: '', contactPhone: '' });
      await loadTickets();
    } catch (err) {
      console.error(err);
    }
  };

  const handleDiagnose = async (id: string) => {
    try {
      await request(`/tickets/${id}/diagnose`, { method: 'POST' });
      await loadTickets();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-medium">GEO 诊断工单</h3>
        <button onClick={() => setShowCreate(!showCreate)} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg">
          + 新建工单
        </button>
      </div>

      {showCreate && (
        <div className="bg-gray-50 rounded-lg p-6 mb-6 border border-gray-200">
          <h4 className="text-lg font-semibold mb-4">新建诊断工单</h4>
          <div className="grid grid-cols-2 gap-4">
            <input placeholder="公司名称 *" value={form.companyName} onChange={e => setForm({ ...form, companyName: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="地址 *" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="网站" value={form.website} onChange={e => setForm({ ...form, website: e.target.value })} className="border rounded px-3 py-2" />
            <select value={form.industry} onChange={e => setForm({ ...form, industry: e.target.value })} className="border rounded px-3 py-2">
              <option value="HVAC">HVAC（暖通空调）</option>
              <option value="Plumbing">Plumbing（水管）</option>
              <option value="Electrical">Electrical（电工）</option>
              <option value="Roofing">Roofing（屋顶）</option>
              <option value="Landscaping">Landscaping（园艺）</option>
              <option value="Pest Control">Pest Control（害虫防治）</option>
              <option value="Cleaning">Cleaning（清洁）</option>
              <option value="Other">其他</option>
            </select>
            <input placeholder="联系电话" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} className="border rounded px-3 py-2" />
            <input placeholder="联系人" value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} className="border rounded px-3 py-2" />
            <textarea placeholder="痛点描述" value={form.painPoints} onChange={e => setForm({ ...form, painPoints: e.target.value })} className="border rounded px-3 py-2 col-span-2" rows={2} />
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={() => void handleCreate()} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg">创建</button>
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 bg-gray-300 hover:bg-gray-400 rounded-lg">取消</button>
          </div>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {[
          { key: 'all', label: '全部' },
          { key: 'pending', label: '待诊断' },
          { key: 'diagnosing', label: '诊断中' },
          { key: 'completed', label: '已完成' },
          { key: 'delivered', label: '已交付' },
        ].map(item => (
          <button key={item.key} onClick={() => setFilter(item.key)}
            className={`px-3 py-1 rounded text-sm ${filter === item.key ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
            {item.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">加载中...</div>
      ) : tickets.length === 0 ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">暂无工单</div>
      ) : (
        <div className="space-y-3">
          {tickets.map(ticket => (
            <div key={ticket.id} className="bg-white rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h4 className="font-medium">{ticket.companyName}</h4>
                    <span className={`px-2 py-0.5 rounded text-xs ${statusColor[ticket.status] || 'bg-gray-100'}`}>
                      {statusLabel[ticket.status] || ticket.status}
                    </span>
                    <span className="bg-gray-100 px-2 py-0.5 rounded text-xs">{ticket.industry}</span>
                    {ticket.diagnosis?.somScore != null && (
                      <span className="bg-purple-100 text-purple-800 px-2 py-0.5 rounded text-xs">
                        SoM: {ticket.diagnosis.somScore.toFixed(0)}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500 mt-1">{ticket.address}</p>
                  {ticket.website && <p className="text-sm text-blue-600 mt-1">{ticket.website}</p>}
                </div>
                <div className="flex gap-2">
                  {ticket.status === 'pending' && (
                    <button onClick={() => void handleDiagnose(ticket.id)}
                      className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white rounded text-sm">
                      开始诊断
                    </button>
                  )}
                  {ticket.status === 'completed' && (
                    <a href={`/tickets/${ticket.id}`} className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-sm">
                      查看报告
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
