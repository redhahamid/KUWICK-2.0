// D-038 — prints a small queue-number slip (thermal-printer friendly):
// clinic name, big number, date/time. Opens the browser print dialog in a
// popup; the front desk picks their receipt printer once and reuses it.
export function printQueueTicket(displayNumber: string, clinicName: string) {
  const printWindow = window.open('', '_blank', 'width=320,height=420');
  if (!printWindow) return;
  const now = new Date();
  printWindow.document.write(`<!doctype html>
<html>
<head>
<title>Queue ${displayNumber}</title>
<style>
  body { font-family: sans-serif; text-align: center; margin: 0; padding: 16px; }
  .clinic { font-size: 14px; font-weight: 600; }
  .number { font-size: 72px; font-weight: 700; margin: 16px 0; }
  .meta { font-size: 12px; color: #555; }
</style>
</head>
<body>
  <div class="clinic">${clinicName}</div>
  <div class="number">${displayNumber}</div>
  <div class="meta">${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
  <div class="meta">Please wait for your number to be called</div>
</body>
</html>`);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
}
