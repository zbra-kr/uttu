import ErpInsightsWorkspace from '@/components/erp-insights/ErpInsightsWorkspace';
import SalesInventoryReadPanel from '@/components/erp-insights/SalesInventoryReadPanel';
import { readConfiguredSalesInventory } from '@/lib/erp/sales-inventory-server';
import { readConfiguredOrderReceipt } from '@/lib/erp/order-receipt-server';
import OrderReceiptReadPanel from '@/components/erp-insights/OrderReceiptReadPanel';
import ReceiptSourceReadPanel from '@/components/erp-insights/ReceiptSourceReadPanel';
import { readConfiguredReceiptSource } from '@/lib/erp/receipt-source-server';
import CentralSalesReadPanel from '@/components/erp-insights/CentralSalesReadPanel';
import { readConfiguredCurrentCentralSales } from '@/lib/erp/central-sales-runtime';

// Review only. No menu, landing, API, credentials or synthetic fixture imports.
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function ErpInsightsReviewPage({searchParams}:{searchParams?:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams??{};
  const central=await readConfiguredCurrentCentralSales({brand:params.brand,from:params.from,to:params.to,aggregate:params.aggregate});
  const state = await readConfiguredSalesInventory();
  const supply = await readConfiguredOrderReceipt();
  const receipts=await readConfiguredReceiptSource({brand:params.brand,styles:params.receiptStyles??params.inventoryStyles,from:params.from,to:params.to});
  return <><ErpInsightsWorkspace /><CentralSalesReadPanel state={central} receiptStyles={receipts.scope?.styles.join(',')}/><SalesInventoryReadPanel state={state} /><OrderReceiptReadPanel state={supply} /><ReceiptSourceReadPanel state={receipts} salesScope={central.scope??undefined}/></>;
}
