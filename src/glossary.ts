// PRD R-X-05: every one of these terms has a one-line explanation in the interface.
export const GLOSSARY = {
  SPV: 'Special purpose vehicle: a single entity that pools many investors into one line on the company’s share register.',
  'nominee / bare trust': 'The SPV holds the shares as nominee under a bare trust: it is the registered holder, but the investors own the shares.',
  'beneficial interest': 'What each investor owns: the economic rights to their shares, held for them by the nominee. It can be a fraction of a share.',
  'minimum commitment': 'The smallest amount an investor can put into this deal. Anyone below it is refunded in full and pays no fees.',
  'scale-back': 'When more money comes in than the round cap allows, every investor is cut back by the same proportion.',
  'S/EIS': 'SEIS and EIS are UK tax schemes for investors in early-stage companies. Relief is per whole share; this tool does not check eligibility.',
  carry: 'Carried interest: the lead’s share of the profit on exit, after investors have their money back.',
  hurdle: 'A minimum return investors must receive (compounding yearly) before the lead earns any carry.',
  'catch-up': 'After the hurdle, a band of profit that goes mostly to the lead until the lead has its full carry share.',
  'tiered carry': 'Carry that rises in steps with the return multiple, each rate applying only to the profit within its band.',
  waterfall: 'The order in which exit money is paid out: costs, then investors’ money back, then hurdle, catch-up and carry.',
  withdrawal: 'Before closing, an investor can pull out with their written consent: everything they paid is refunded and they are left out of the allocation.',
  'fee payer': 'Who bears a fee: the investors (from or on top of what they wire), the company (from the wire it receives) or the lead (by invoice).',
  'MT103 / UETR': 'An MT103 is the bank’s record of an international transfer; the UETR on it is a 36-character number that tracks the payment between banks.',
} as const

export type Term = keyof typeof GLOSSARY
