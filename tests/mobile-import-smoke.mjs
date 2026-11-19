import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const root = process.cwd();
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg'
};

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    const relative = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.resolve(root, '.' + relative);
    if (!target.startsWith(root + path.sep) && target !== path.join(root, 'index.html')) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    fs.readFile(target, (error, data) => {
      if (error) {
        res.writeHead(404).end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': mime[path.extname(target)] || 'application/octet-stream',
        'Cache-Control': 'no-store'
      });
      res.end(data);
    });
  } catch (error) {
    res.writeHead(400).end('Bad request');
  }
});

const listen = () => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

let browser;
try {
  const port = await listen();
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block'
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('http://127.0.0.1:' + port + '/index.html', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianEngine.ready, null, { timeout: 60000 });
  await page.evaluate(async () => {
    await window.ValerianEngine.ready;
    if (window.__valerianDurableStateReady === false) {
      throw new Error('The local durable store did not initialize.');
    }
  });

  const fixture = await page.evaluate(async () => {
    const api = window.ValerianEngine;
    const name = 'VALERIAN-AUTOTEST-IMPORT-' + Date.now();
    const productResult = await api.addProduct({
      name,
      productType: 'مزيلات عرق',
      category: 'رجالي',
      size: '150 مل',
      price: 250,
      averageCost: 100,
      stock: 0,
      stockUnit: 'وحدة'
    });
    if (!productResult?.ok || !productResult.product?.id) {
      throw new Error('Test product could not be created through the business engine.');
    }

    const invoiceResult = await api.createImportInvoice({
      supplier: 'VALERIAN TEST SUPPLIER',
      date: new Date().toISOString().slice(0, 10),
      exchangeRate: 50,
      shippingCost: 10,
      customsCost: 5,
      paidAmount: 0,
      paymentMethod: 'نقدي',
      lines: [{ productId: productResult.product.id, qty: 2, unitForeign: 10 }]
    });
    if (invoiceResult?.ok !== true) {
      throw new Error(invoiceResult?.error || 'Valid test import invoice was not approved.');
    }

    const snapshot = api.getSnapshot();
    const product = snapshot.products.find((item) => String(item.id) === String(productResult.product.id));
    const invoice = snapshot.imports.find((item) => String(item.id) === String(invoiceResult.invoice?.id));
    const supplierInvoice = snapshot.supplierInvoices.find((item) => String(item.id) === String(invoiceResult.invoice?.id));
    if (!product || Number(product.stock) !== 2) throw new Error('Import did not add the expected stock quantity.');
    if (!invoice || !supplierInvoice) throw new Error('Import was not recorded in both import and supplier ledgers.');
    if (Number(invoice.totalEgp) !== 1015) throw new Error('Import total mismatch: expected 1015 EGP, got ' + invoice.totalEgp);
    if (Number(product.price) !== 250) throw new Error('Import unexpectedly changed the existing retail price.');
    return {
      productId: product.id,
      productName: product.name,
      stock: product.stock,
      retailPrice: product.price,
      invoiceId: invoice.id,
      invoiceTotal: invoice.totalEgp,
      supplierDue: Number(supplierInvoice.totalAmount) - Number(supplierInvoice.paidAmount || 0)
    };
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.ValerianEngine && !!window.ValerianEngine.ready, null, { timeout: 60000 });
  const restored = await page.evaluate(async (productId, invoiceId) => {
    await window.ValerianEngine.ready;
    const snapshot = window.ValerianEngine.getSnapshot();
    const product = snapshot.products.find((item) => String(item.id) === String(productId));
    const invoice = snapshot.imports.find((item) => String(item.id) === String(invoiceId));
    return !!product && Number(product.stock) === 2 && !!invoice;
  }, fixture.productId, fixture.invoiceId);

  if (!restored) throw new Error('The imported product/invoice did not survive a full page reload.');
  if (pageErrors.length) throw new Error('Browser runtime errors: ' + pageErrors.join(' | '));

  console.log('VALERIAN mobile import browser test: PASSED');
  console.log(JSON.stringify(fixture));
  console.log(' - Engine startup, product creation, import approval, stock update, supplier ledger, retail-price preservation, and reload persistence verified.');
  await context.close();
} catch (error) {
  console.error('VALERIAN mobile import browser test: FAILED');
  console.error(error?.stack || error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
