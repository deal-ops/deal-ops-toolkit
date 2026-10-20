// Fictional sample deal (Test Plan §3). Every name, company and number is made up.
import type { Commitment, BankLine } from './reconcile'
import type { Fee } from './allocation'
import type { DealSettings } from './deal'

export const SAMPLE_SETTINGS: DealSettings = {
  name: 'Northwind Robotics — Seed SPV (fictional sample)',
  currency: 'GBP',
  asOf: '2026-10-16',
  feeBasis: 'deducted',
  minimum: 100_000,
  agedThresholdDays: 10,
}

export const SAMPLE_PRICE_MICROS = 2_413_700
export const SAMPLE_CAP = 15_000_000

export const SAMPLE_FEES: Fee[] = [
  { id: 'f1', label: 'Platform fee', kind: 'percent', value: 300, payer: 'investors' },
  { id: 'f2', label: 'Legal & admin', kind: 'fixed', value: 150_000, payer: 'company' },
]

const people: [string, string, string, number, Commitment['scheme']][] = [
  ['c01', 'Amelia Hart', 'NW-001', 10_000, 'SEIS'],
  ['c02', 'Ben Okafor', 'NW-002', 5_000, 'EIS'],
  ['c03', 'Chloe Martin', 'NW-003', 20_000, 'none'],
  ['c04', 'David Kim', 'NW-004', 2_500, 'SEIS'],
  ['c05', 'Elena Rossi', 'NW-005', 15_000, 'EIS'],
  ['c06', 'Farhan Malik', 'NW-006', 10_000, 'EIS'],
  ['c07', 'Grace Liu', 'NW-007', 25_000, 'none'],
  ['c08', 'Hugo Bernard', 'NW-008', 5_000, 'SEIS'],
  ['c09', 'Isla Campbell', 'NW-009', 1_000, 'none'],
  ['c10', 'James Whitfield', 'NW-010', 20_000, 'EIS'],
  ['c11', 'Kavya Iyer', 'NW-011', 7_500, 'SEIS'],
  ['c12', 'Lucas Meyer', 'NW-012', 3_000, 'none'],
]

export const SAMPLE_COMMITMENTS: Commitment[] = people.map(([id, name, reference, pounds, scheme]) => ({
  id,
  name,
  email: `${name.split(' ')[0].toLowerCase()}@example.com`,
  reference,
  cashDue: pounds * 100,
  scheme,
}))

const line = (id: string, date: string, pounds: number, payer: string, reference: string): BankLine => ({
  id,
  txnId: id,
  date: `2026-${date}`,
  amount: Math.round(pounds * 100),
  payer,
  reference,
})

export const SAMPLE_BANK: BankLine[] = [
  line('t01', '10-06', 10_000, 'A HART', 'NW-001'),
  line('t02', '10-06', 5_000, 'B OKAFOR', 'NW002 NORTHWIND'),
  line('t03', '10-07', 20_000, 'CHLOE MARTIN', ''),
  line('t04', '10-07', 2_000, 'D KIM', 'NW-004'),
  line('t05', '10-08', 15_000, 'ROSSI FAMILY OFFICE LTD', 'NORTHWIND SEED'),
  line('t06', '10-08', 10_000, 'F MALIK', 'NW-006'),
  line('t07', '10-09', 25_000, 'GRACE LIU', 'NW-007'),
  line('t08', '10-09', 5_000, 'H BERNARD', 'NW-008'),
  line('t09', '10-10', 5_000, 'H BERNARD', 'NW-008'),
  line('t10', '10-10', 1_000, 'ISLA CAMPBELL', 'NW-009'),
  line('t11', '10-03', 2_340, 'WESTBRIDGE SUPPLIES', 'INV 4471'),
  line('t12', '10-14', 7_500, 'K IYER', 'NW 11'),
  line('t13', '10-15', 3_000, 'L MEYER', 'NW-012'),
  line('t14', '10-15', 4_000, 'SAM PATEL', 'NW-0019'),
  line('t15', '10-15', -45, 'BANK CHARGE', 'FEE'),
  line('t16', '10-18', 3_000, 'J WHITFIELD', 'NW-010'),
]

/** Exit terms used by the sample (Test Plan §3). */
export const SAMPLE_EXIT = { proceeds: 39_000_000, exitCosts: 450_000, years100: 600, carry: { mode: 'fixed' as const, k: 2000, h: 800, c: 10_000 } }
