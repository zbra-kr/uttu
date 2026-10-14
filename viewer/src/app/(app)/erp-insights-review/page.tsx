import ErpStatusOverview from '@/components/erp-insights/ErpStatusOverview';
import CentralSalesReadPanel from '@/components/erp-insights/CentralSalesReadPanel';
import ReceiptSourceReadPanel from '@/components/erp-insights/ReceiptSourceReadPanel';
import { readConfiguredCurrentCentralSales } from '@/lib/erp/central-sales-runtime';
import { readConfiguredReceiptSource } from '@/lib/erp/receipt-source-server';
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function ErpInsightsReviewPage({searchParams}:{searchParams?:Promise<Record<string,string|string[]|undefined>>}) {
 const params=await searchParams??{};
 // Defaults only for an untouched initial request; malformed supplied scopes remain fail-closed.
 const initial=['brand','from','to','aggregate'].every(k=>params[k]===undefined);
 const end=new Date(Date.now()-86400000).toLocaleDateString('en-CA',{timeZone:'Asia/Seoul'});
 const start=new Date(Date.parse(end+'T00:00:00Z')-6*86400000).toISOString().slice(0,10);
 const query=initial?{...params,brand:'CO',from:start,to:end,aggregate:'daily'}:params;
 const central=await readConfiguredCurrentCentralSales({brand:query.brand,from:query.from,to:query.to,aggregate:query.aggregate});
 const receipts=await readConfiguredReceiptSource({brand:query.brand,styles:query.receiptStyles??query.inventoryStyles,from:query.from,to:query.to});
 return <main className="erp-status mx-auto max-w-7xl space-y-6 p-4 md:p-8"><style>{`.erp-status form{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:16px 0}.erp-status label{display:flex;flex-direction:column;gap:5px;font-size:13px}.erp-status input,.erp-status select{border:1px solid #cbd5e1;border-radius:8px;padding:8px;background:white}.erp-status button{background:#1d4ed8;color:white;border-radius:8px;padding:9px 18px}.erp-status table{width:100%;border-collapse:collapse;font-size:13px}.erp-status th,.erp-status td{text-align:left;padding:10px;border-bottom:1px solid #e2e8f0}.erp-status th{background:#f8fafc}.erp-status section{overflow-x:auto}.erp-status h2{font-weight:600}.erp-status details{margin:12px 0}.erp-status caption{text-align:left;padding:12px 0}`}</style><header><p className="text-sm text-slate-500">UTTU · ERP</p><h1 className="text-3xl font-semibold">매출·입고 현황</h1><p className="mt-2 text-slate-600">브랜드와 기간의 원천 관측을 함께 확인합니다.</p></header><div className="rounded-2xl border bg-white p-5"><CentralSalesReadPanel state={central} receiptStyles={receipts.scope?.styles.join(',')}><ErpStatusOverview sales={central} receipts={receipts}/></CentralSalesReadPanel></div><div className="rounded-2xl border bg-white p-5"><ReceiptSourceReadPanel state={receipts} salesScope={central.scope??undefined}/></div><aside className="rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-semibold">재고·발주 연결 상태</h2><p>재고: 업무 기준시각 미확인 · 발주: 화면 공급자 미연결. 재고 수량·발주 합계·입고율·예상 납기를 표시할 수 없습니다.</p></aside></main>;
}
