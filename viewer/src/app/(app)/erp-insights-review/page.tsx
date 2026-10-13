import ErpInsightsWorkspace from '@/components/erp-insights/ErpInsightsWorkspace';
import SalesInventoryReadPanel from '@/components/erp-insights/SalesInventoryReadPanel';
import { readConfiguredSalesInventory } from '@/lib/erp/sales-inventory-server';
import { readConfiguredOrderReceipt } from '@/lib/erp/order-receipt-server';
import OrderReceiptReadPanel from '@/components/erp-insights/OrderReceiptReadPanel';
import CentralSalesReadPanel from '@/components/erp-insights/CentralSalesReadPanel';
import { readConfiguredCurrentCentralSales } from '@/lib/erp/central-sales-runtime';
import { readConfiguredInventory } from '@/lib/erp/inventory-server';

// Review only. No menu, landing, API, credentials or synthetic fixture imports.
export const dynamic='force-dynamic';
export const runtime='nodejs';
export default async function ErpInsightsReviewPage({searchParams}:{searchParams?:Promise<Record<string,string|string[]|undefined>>}) {
  const params=await searchParams??{};
  const central=await readConfiguredCurrentCentralSales({brand:params.brand,from:params.from,to:params.to});
  const state = await readConfiguredSalesInventory();
  const supply = await readConfiguredOrderReceipt();
  const inventory=await readConfiguredInventory({brand:params.brand,styles:params.inventoryStyles});
  return <><ErpInsightsWorkspace /><CentralSalesReadPanel state={central} inventoryStyles={inventory.scope?.styles.join(',')}/><SalesInventoryReadPanel state={state} inventory={inventory} salesPeriod={central.scope?{from:central.scope.from,to:central.scope.to}:undefined}/><OrderReceiptReadPanel state={supply} /></>;
}
