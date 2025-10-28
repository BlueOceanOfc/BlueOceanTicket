import { parseRawMessage } from '../services/utils.js';

const samples = [
  '1, 2,3,4,5,6',
  '1,2,3,4,5,6',
  '1,  2, 3, 4,5,6',
  '<b>Order ID:</b> 1, 2,3,4,5,6',
  '1,, 2,3,4,5,6',
];

for (const s of samples) {
  const parsed = parseRawMessage(s);
  console.log('---');
  console.log('Input:', JSON.stringify(s));
  console.log('Parsed orderIds:', parsed.orderIds);
  console.log(
    'Extracted IDs simple:',
    (parsed.orderIds || []).map((x) => x.id),
  );
}
