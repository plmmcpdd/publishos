import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { request } from '../api';

interface Ticket {
  id: string;
  companyName: string;
  address: string;
  website?: string;
  industry: string;
  status: string;
  painPoints?: string;
  photos: Array<{ id: string; url: string; caption?: string; type: string }>;
  diagnosis?: {
    somScore?: number;
    somChatgpt?: number;
    somGemini?: number;
    somPerplexity?: number;
    scoreGmb?: number;
    scoreWeb?: number;
    scoreContent?: number;
    scoreTrust?: number;
    scoreLocal?: number;
    aiSearchResults?: any;
    coreFindings?: any;
    competitors?: any;
    recommendations?: any;
    revenueImpact?: any;
    summary?: string;
    fullReport?: string;
    status: string;
  } | null;
}

const somColor = (score: number) => {
  if (score >= 70) return 'text-green-600';
  if (score >= 40) return 'text-yellow-600';
  return 'text-red-600';
};

export default function TicketDetail() {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);

  useEffect(() => {
    if (!id) return;
    request<{ success: boolean; data: Ticket }>(`/tickets/${id}`)
      .then(res => setTicket(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const handlePublish = async () => {
    if (!id || !ticket?.diagnosis) return;
    setPublishing(true);
    try {
      await request(`/tickets/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'delivered' }) });
      setTicket(prev => prev ? { ...prev, status: 'delivered' } : prev);
    } catch (err) {
      console.error(err);
    } finally {
      setPublishing(false);
    }
  };

  if (loading) return <div className="bg-white rounded-xl p-8 text-center text-gray-500">加载中...</div>;
  if (!ticket) return <div className="bg-white rounded-xl p-8 text-center text-gray-500">工单不存在</div>;

  const d = ticket.diagnosis;
  const findings = (d?.coreFindings as any[]) || [];
  const recs = (d?.recommendations as any[]) || [];
  const comps = (d?.competitors as any[]) || [];
  const aiResults = (d?.aiSearchResults as any[]) || [];

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-medium">{ticket.companyName} — GEO 诊断报告</h3>
          <p className="text-sm text-gray-500">{ticket.address} · {ticket.industry}</p>
        </div>
        {ticket.status === 'completed' && (
          <button onClick={() => void handlePublish()} disabled={publishing}
            className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg disabled:opacity-50">
            {publishing ? '处理中...' : '标记已交付'}
          </button>
        )}
      </div>

      {!d ? (
        <div className="bg-white rounded-xl p-8 text-center text-gray-500">
          {ticket.status === 'diagnosing' ? '诊断进行中，请稍候...' : '尚未生成诊断报告'}
        </div>
      ) : (
        <>
          {/* SoM Score */}
          <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
            <h4 className="text-sm font-medium text-gray-500 mb-4">Share of Model（AI 可见性）</h4>
            <div className="flex items-center gap-8">
              <div className="text-center">
                <div className={`text-5xl font-bold ${somColor(d.somScore || 0)}`}>{d.somScore?.toFixed(0) || '-'}</div>
                <div className="text-sm text-gray-500 mt-1">综合 SoM</div>
              </div>
              <div className="grid grid-cols-3 gap-6 flex-1">
                <div className="text-center">
                  <div className={`text-2xl font-bold ${somColor(d.somChatgpt || 0)}`}>{d.somChatgpt?.toFixed(0) || '-'}</div>
                  <div className="text-xs text-gray-500">ChatGPT</div>
                </div>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${somColor(d.somGemini || 0)}`}>{d.somGemini?.toFixed(0) || '-'}</div>
                  <div className="text-xs text-gray-500">Gemini</div>
                </div>
                <div className="text-center">
                  <div className={`text-2xl font-bold ${somColor(d.somPerplexity || 0)}`}>{d.somPerplexity?.toFixed(0) || '-'}</div>
                  <div className="text-xs text-gray-500">Perplexity</div>
                </div>
              </div>
            </div>
          </div>

          {/* Dimensional Scores */}
          <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
            <h4 className="text-sm font-medium text-gray-500 mb-4">分项评分</h4>
            <div className="grid grid-cols-5 gap-4">
              {[
                { label: 'GBP 完整度', score: d.scoreGmb },
                { label: '网站质量', score: d.scoreWeb },
                { label: '内容权威', score: d.scoreContent },
                { label: '信任信号', score: d.scoreTrust },
                { label: '本地存在', score: d.scoreLocal },
              ].map(item => (
                <div key={item.label} className="text-center">
                  <div className={`text-2xl font-bold ${somColor(item.score || 0)}`}>{item.score?.toFixed(0) || '-'}</div>
                  <div className="text-xs text-gray-500 mt-1">{item.label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* AI Search Test */}
          {aiResults.length > 0 && (
            <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
              <h4 className="text-sm font-medium text-gray-500 mb-4">AI 搜索测试</h4>
              <div className="space-y-3">
                {aiResults.map((r: any, i: number) => (
                  <div key={i} className="flex items-start gap-3 text-sm">
                    <span className={r.mentioned ? 'text-green-600' : 'text-red-600'}>
                      {r.mentioned ? '✓' : '✗'}
                    </span>
                    <div className="flex-1">
                      <div className="font-medium">{r.question}</div>
                      {r.quote && <div className="text-gray-500 mt-1 italic">"{r.quote}"</div>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Core Findings */}
          {findings.length > 0 && (
            <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
              <h4 className="text-sm font-medium text-gray-500 mb-4">关键发现</h4>
              <div className="space-y-4">
                {findings.map((f: any, i: number) => (
                  <div key={i} className="border-l-4 pl-4" style={{
                    borderColor: f.severity === 'critical' ? '#dc2626' : f.severity === 'major' ? '#f59e0b' : '#10b981'
                  }}>
                    <div className="font-medium">{f.title}</div>
                    <div className="text-sm text-gray-600 mt-1">{f.detail}</div>
                    {f.recommendation && <div className="text-sm text-blue-600 mt-1">建议：{f.recommendation}</div>}
                    {f.impact && <div className="text-sm text-gray-500 mt-1">预期影响：{f.impact}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Competitors */}
          {comps.length > 0 && (
            <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
              <h4 className="text-sm font-medium text-gray-500 mb-4">竞品对比</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">公司</th>
                    <th className="text-center py-2">SoM 评分</th>
                    <th className="text-center py-2">评分</th>
                    <th className="text-center py-2">评论数</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b bg-purple-50">
                    <td className="py-2 font-medium">{ticket.companyName}（你）</td>
                    <td className="text-center py-2">{d.somScore?.toFixed(0) || '-'}</td>
                    <td className="text-center py-2">-</td>
                    <td className="text-center py-2">-</td>
                  </tr>
                  {comps.map((c: any, i: number) => (
                    <tr key={i} className="border-b">
                      <td className="py-2">{c.name}</td>
                      <td className="text-center py-2">{c.somScore || '-'}</td>
                      <td className="text-center py-2">{c.rating || '-'}</td>
                      <td className="text-center py-2">{c.reviewCount || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recommendations */}
          {recs.length > 0 && (
            <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
              <h4 className="text-sm font-medium text-gray-500 mb-4">优化建议</h4>
              <div className="space-y-3">
                {recs.map((r: any, i: number) => (
                  <div key={i} className="flex items-start gap-3">
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      r.priority === 'high' ? 'bg-red-100 text-red-800' :
                      r.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-green-100 text-green-800'
                    }`}>{r.priority === 'high' ? '高' : r.priority === 'medium' ? '中' : '低'}</span>
                    <div className="flex-1">
                      <div className="font-medium">{r.action}</div>
                      <div className="text-sm text-gray-500 mt-1">
                        效果：{r.impact} · 投入：{r.effort} · 见效：{r.timeline}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full Report */}
          {d.fullReport && (
            <div className="bg-white rounded-xl p-6 shadow-sm mb-6">
              <h4 className="text-sm font-medium text-gray-500 mb-4">完整报告</h4>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap">{d.fullReport}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
