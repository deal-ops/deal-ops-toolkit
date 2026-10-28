#!/usr/bin/env python3
"""Independent reference implementation ("oracle") of the Deal Ops Toolkit engines.

Written from the PRD §5.0-5.4 (v0.8: C-REC-7, C-ALL-10, C-ALL-11; Chinese source of truth, English snapshot in
docs/en/01_PRD.md), the test plan and scripts/oracle/SCHEMA.md only.
Usage: python3 scripts/oracle/oracle.py <case.json>

All money is integer minor units, rates are basis points, prices are micros,
multiples/years are hundredths. Arithmetic is exact (int / Fraction); the only
hurdle (C-DIS-3) is computed exactly too: half-up rounding of C*((1+h)^n - 1) is
decided by exact rational comparisons (see hurdle_amount).
"""
import json
import re
import sys
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, getcontext
from fractions import Fraction

BP = 10000


class Invalid(Exception):
    pass


# ---------------------------------------------------------------- helpers

def half_up(x):
    """Round a non-negative (or any) Fraction/int half away from zero."""
    x = Fraction(x)
    if x < 0:
        return -half_up(-x)
    return int((x + Fraction(1, 2)).__floor__())


def floor_frac(x):
    return Fraction(x).__floor__()


def largest_remainder(total, weights):
    """Split integer total in proportion to integer weights; sum is exact.
    Remainders compared exactly; ties go to the earlier item."""
    wsum = sum(weights)
    if wsum <= 0:
        return [0] * len(weights)
    shares = []
    rems = []
    for w in weights:
        q, r = divmod(total * w, wsum)
        shares.append(q)
        rems.append(r)
    left = total - sum(shares)
    order = sorted(range(len(weights)), key=lambda i: (-rems[i], i))
    for i in order[:left]:
        shares[i] += 1
    return shares


def is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def need_int(v, lo=None, hi=None):
    if not is_int(v):
        raise Invalid("not an integer: %r" % (v,))
    if lo is not None and v < lo:
        raise Invalid("below range: %r" % (v,))
    if hi is not None and v > hi:
        raise Invalid("above range: %r" % (v,))
    return v


MONEY_MAX = 100000000000  # 1,000,000,000.00 in minor units (I-01)


# ---------------------------------------------------------------- allocation

def allocation(case):
    basis = case.get("feeBasis")
    if basis not in ("deducted", "onTop"):
        raise Invalid("feeBasis")
    minimum = case.get("minimum", 0)
    if minimum is None:
        minimum = 0
    need_int(minimum, 0, MONEY_MAX)
    cap = case.get("cap")
    if cap is not None:
        need_int(cap, 1, MONEY_MAX)
    price = need_int(case.get("priceMicros"), 1, 1000000 * 1000000)

    fees = case.get("fees") or []
    if len(fees) > 20:
        raise Invalid("more than 20 fees (I-08)")
    fee_ids = set()
    for f in fees:
        fid = f.get("id")
        if not isinstance(fid, str) or fid in fee_ids:
            raise Invalid("fee id")
        fee_ids.add(fid)
        kind, payer, value = f.get("kind"), f.get("payer"), f.get("value")
        if payer == "investors":
            if kind not in ("percent", "perInvestor"):
                raise Invalid("fee combination")
        elif payer in ("company", "lead"):
            if kind not in ("percent", "fixed"):
                raise Invalid("fee combination")
        else:
            raise Invalid("fee payer")
        if kind == "percent":
            need_int(value, 0, BP)
        else:
            need_int(value, 1, MONEY_MAX)

    inv_pct = [f for f in fees if f["payer"] == "investors" and f["kind"] == "percent"]
    inv_fix = [f for f in fees if f["payer"] == "investors" and f["kind"] == "perInvestor"]
    inv_fee_ids = [f["id"] for f in fees if f["payer"] == "investors"]
    p = sum(f["value"] for f in inv_pct)
    F = sum(f["value"] for f in inv_fix)
    if basis == "deducted" and p >= BP:
        raise Invalid("investor percent fees >= 100% on deducted basis")

    investors = case.get("investors") or []
    if len(investors) > 500:
        raise Invalid("more than 500 investors (I-08)")
    ids = set()
    for inv in investors:
        if not isinstance(inv.get("id"), str) or inv["id"] in ids:
            raise Invalid("investor id")
        ids.add(inv["id"])
        need_int(inv.get("received"), 0, MONEY_MAX)
        if inv.get("scheme", "none") not in ("none", "SEIS", "EIS"):
            raise Invalid("scheme")

    def commitment_basis_ok(R, M):
        amt = R if basis == "deducted" else M
        return amt >= minimum

    # C-ALL-1 / C-ALL-2
    M_of = {}
    for inv in investors:
        R = inv["received"]
        if R <= F:
            continue
        if basis == "deducted":
            M = floor_frac(Fraction((R - F) * (BP - p), BP))
        else:
            M = floor_frac(Fraction((R - F) * BP, BP + p))
        if M <= 0:
            continue
        if not commitment_basis_ok(R, M):
            continue
        M_of[inv["id"]] = M

    part_ids = [inv["id"] for inv in investors if inv["id"] in M_of]
    blockers = set()

    # C-ALL-3
    T_of = dict(M_of)
    msum = sum(M_of.values())
    if cap is not None and msum > cap:
        split = largest_remainder(cap, [M_of[i] for i in part_ids])
        T_of = dict(zip(part_ids, split))
        for i in part_ids:
            T = T_of[i]
            if basis == "deducted":
                amt = Fraction(T * BP, BP - p) + F
            else:
                amt = Fraction(T)
            if amt < minimum:
                blockers.add("scale-back-below-minimum")

    def pct_fee(I, rate):
        if basis == "deducted":
            return half_up(Fraction(I * rate, BP - p))
        return half_up(Fraction(I * rate, BP))

    out_inv = {}
    total_invested = 0
    fee_totals = {f["id"]: 0 for f in fees}
    n_part = 0
    for inv in investors:
        iid, R = inv["id"], inv["received"]
        res = None
        if iid in T_of:
            I = T_of[iid]
            while I > 0:
                fmap = {}
                for f in fees:
                    if f["payer"] != "investors":
                        continue
                    fmap[f["id"]] = pct_fee(I, f["value"]) if f["kind"] == "percent" else f["value"]
                refund = R - I - sum(fmap.values())
                if refund >= 0:
                    res = (I, fmap, refund)
                    break
                I -= 1
        if res is None:
            out_inv[iid] = {
                "participating": False, "invested": 0, "fees": {}, "refund": R,
                "microShares": 0, "claimableShares": 0, "claimableAmount": 0,
            }
            continue
        I, fmap, refund = res
        n_part += 1
        total_invested += I
        for k, v in fmap.items():
            fee_totals[k] += v
        claim_sh = (I * BP) // price
        out_inv[iid] = {
            "participating": True,
            "invested": I,
            "fees": {k: fmap[k] for k in inv_fee_ids},
            "refund": refund,
            "microShares": (I * BP * 1000000) // price,
            "claimableShares": claim_sh,
            "claimableAmount": (claim_sh * price) // BP,
        }

    # C-ALL-9
    company_fees = 0
    lead_invoice = 0
    for f in fees:
        if f["payer"] == "investors":
            continue
        amt = half_up(Fraction(total_invested * f["value"], BP)) if f["kind"] == "percent" else f["value"]
        fee_totals[f["id"]] = amt
        if f["payer"] == "company":
            company_fees += amt
        else:
            lead_invoice += amt
    wire = total_invested - company_fees
    if wire < 0:
        blockers.add("company-fees-exceed")
    if n_part == 0:
        blockers.add("no-participants")

    return {
        "ok": True,
        "investors": out_inv,
        "feeTotals": fee_totals,
        "totalInvested": total_invested,
        "companyFees": company_fees,
        "leadInvoice": lead_invoice,
        "wire": wire,
        "blockers": sorted(blockers),
    }


# ---------------------------------------------------------------- fee payer change (C-ALL-10, v0.8)

class ArithmeticFail(Exception):
    """C-03 'arithmetic check failed' (internal error): never caught by run()."""


def _alloc_case(case, fees, investors, minimum=None, cap="same"):
    return {
        "kind": "allocation", "feeBasis": case.get("feeBasis"),
        "minimum": case.get("minimum", 0) if minimum is None else minimum,
        "cap": case.get("cap") if cap == "same" else cap,
        "priceMicros": case.get("priceMicros"), "fees": fees,
        "investors": investors,
    }


def single_invested(case, fees, R):
    """I(R): C-ALL-1, C-ALL-4, C-ALL-6, C-ALL-7 for one investor under `fees`,
    ignoring cap and minimum (minimum 0, no cap). Reuses allocation()."""
    out = allocation(_alloc_case(case, fees, [{"id": "x", "received": R, "scheme": "none"}], minimum=0, cap=None))
    return out["investors"]["x"]["invested"]


def ceil_frac(x):
    return -((-Fraction(x)).__floor__())


def new_cash_due(case, fees2, T):
    """Smallest whole-penny R with I(R) >= T under fees2 (C-ALL-10 step 2).

    Own derivation: I(R) <= M(R) (C-ALL-7 only lowers I) and M(R) is non-decreasing in R.
    deducted: M(R) = floor((R - F')(1 - p')) >= T  <=>  R >= F' + T/(1 - p')  <=>  R >= F' + ceil(T/(1 - p')).
    onTop:    M(R) = floor((R - F')/(1 + p')) >= T  <=>  R >= F' + T(1 + p')  <=>  R >= F' + ceil(T(1 + p')).
    So no R below R0 can give I(R) >= T; scan upward from R0 (each R checked with the full
    single-investor allocation), which therefore yields the minimum."""
    inv_pct = sum(f["value"] for f in fees2 if f["payer"] == "investors" and f["kind"] == "percent")
    inv_fix = sum(f["value"] for f in fees2 if f["payer"] == "investors" and f["kind"] == "perInvestor")
    if case.get("feeBasis") == "deducted":
        R = inv_fix + ceil_frac(Fraction(T * BP, BP - inv_pct))
    else:
        R = inv_fix + ceil_frac(Fraction(T * (BP + inv_pct), BP))
    for _ in range(100000):
        if R > MONEY_MAX:
            raise Invalid("new cash due above I-01 limit")
        I = single_invested(case, fees2, R)
        if I >= T:
            if I != T:  # PRD C-ALL-10: always exact; otherwise C-03 arithmetic failure
                raise ArithmeticFail("I(N) = %d != T = %d" % (I, T))
            return R
        R += 1
    raise ArithmeticFail("no N found within 100000 pence of the lower bound")


def fee_payer_change(case):
    fees = case.get("fees") or []
    fee_id = case.get("feeId")
    new_payer = case.get("newPayer")
    sel = [f for f in fees if f.get("id") == fee_id]
    if len(sel) != 1 or sel[0].get("kind") != "percent":
        raise Invalid("selected fee must be one percent fee")
    if new_payer not in ("investors", "company", "lead"):
        raise Invalid("new payer")
    applied = case.get("applied")
    if applied is None and sel[0].get("payer") == new_payer:
        raise Invalid("new payer equals current payer")
    fees2 = [dict(f, payer=new_payer) if f.get("id") == fee_id else f for f in fees]

    investors = case.get("investors") or []
    ids = []
    for inv in investors:
        iid = inv.get("id")
        if not isinstance(iid, str) or iid in ids:
            raise Invalid("investor id")
        ids.append(iid)
        need_int(inv.get("cashDue"), 1, MONEY_MAX)
    due = {inv["id"]: inv["cashDue"] for inv in investors}
    scheme = {inv["id"]: inv.get("scheme", "none") for inv in investors}

    # input validation of Fees and Fees' (R-ALL-01/02); raises Invalid -> ok:false
    allocation(_alloc_case(case, fees, []))
    allocation(_alloc_case(case, fees2, []))

    blockers = set()
    fee_before = None
    if applied is None:
        # step 1: commitment allocation under Fees with R = cash due
        a1 = allocation(_alloc_case(case, fees, [{"id": i, "received": due[i], "scheme": scheme[i]} for i in ids]))
        part1 = {i: a1["investors"][i]["participating"] for i in ids}
        fee_before = a1["feeTotals"][fee_id]
        for b in a1["blockers"]:
            blockers.add(("before-" + b, ""))
        # C-ALL-3: the round is scaled back iff the participants' M (C-ALL-1/2) sum exceeds the cap
        m_sum = sum(_m_of(case, fees, due[i]) for i in ids if _m_of_participates(case, fees, due[i]))
        if case.get("cap") is not None and m_sum > case["cap"]:
            blockers.add(("over-cap", ""))
        target = {i: a1["investors"][i]["invested"] for i in ids if part1[i]}
    else:
        tg = applied.get("targets") or {}
        nd = applied.get("newCashDue") or {}
        if set(tg) != set(nd) or not set(tg) <= set(ids):
            raise Invalid("applied targets / newCashDue")
        for i in tg:
            need_int(tg[i], 1, MONEY_MAX)
            need_int(nd[i], 1, MONEY_MAX)
        part1 = {i: i in tg for i in ids}
        target = dict(tg)

    out_inv = {}
    step1_ok = not blockers
    if not step1_ok:
        for i in ids:
            out_inv[i] = {"cashDue": due[i], "participatingBefore": part1[i], "unchanged": None, "target": None,
                          "newCashDue": None, "difference": None, "participatingAfter": None, "investedAfter": None}
        return _fpc_out(blockers, out_inv, ids, due, fee_before, None, False)

    # step 2
    N = {}
    for i in ids:
        if part1[i]:
            N[i] = new_cash_due(case, fees2, target[i]) if applied is None else applied["newCashDue"][i]
        else:
            N[i] = due[i]
    # step 3
    a3 = allocation(_alloc_case(case, fees2, [{"id": i, "received": N[i], "scheme": scheme[i]} for i in ids]))
    for b in a3["blockers"]:
        blockers.add(("after-" + b, ""))
    F2 = sum(f["value"] for f in fees2 if f["payer"] == "investors" and f["kind"] == "perInvestor")
    minimum = case.get("minimum", 0) or 0
    for i in ids:
        v = a3["investors"][i]
        if part1[i] and not v["participating"]:
            if N[i] > F2:
                M = _m_of(case, fees2, N[i])
                basis_amt = N[i] if case["feeBasis"] == "deducted" else M
                below = M > 0 and basis_amt < minimum
            else:
                below = False
            blockers.add(("would-fall-below-minimum" if below else "would-leave", i))
        elif not part1[i] and v["participating"]:
            blockers.add(("would-join", i))
        elif part1[i] and v["invested"] != target[i]:
            blockers.add(("invested-differs", i))
        out_inv[i] = {
            "cashDue": due[i], "participatingBefore": part1[i], "unchanged": not part1[i],
            "target": target[i] if part1[i] else None, "newCashDue": N[i], "difference": N[i] - due[i],
            "participatingAfter": v["participating"], "investedAfter": v["invested"],
        }
    return _fpc_out(blockers, out_inv, ids, due, fee_before, a3["feeTotals"][fee_id], True)


def _m_of(case, fees, R):
    """M of C-ALL-1 (before rounding adjustments of C-ALL-7); 0 when R <= F."""
    p = sum(f["value"] for f in fees if f["payer"] == "investors" and f["kind"] == "percent")
    F = sum(f["value"] for f in fees if f["payer"] == "investors" and f["kind"] == "perInvestor")
    if R <= F:
        return 0
    if case["feeBasis"] == "deducted":
        return floor_frac(Fraction((R - F) * (BP - p), BP))
    return floor_frac(Fraction((R - F) * BP, BP + p))


def _m_of_participates(case, fees, R):
    """C-ALL-1/C-ALL-2 participation (the set whose M is summed in C-ALL-3)."""
    M = _m_of(case, fees, R)
    if M <= 0:
        return False
    amt = R if case["feeBasis"] == "deducted" else M
    return amt >= (case.get("minimum", 0) or 0)


def _fpc_out(blockers, out_inv, ids, due, fee_before, fee_after, computed):
    bl = [{"code": c, "investor": (i or None)} for c, i in sorted(blockers)]
    tot = {"cashDue": sum(due[i] for i in ids), "newCashDue": None, "difference": None,
           "topUpCount": None, "topUpTotal": None, "refundCount": None, "refundTotal": None}
    if computed:
        diffs = [out_inv[i]["difference"] for i in ids]
        tot.update({
            "newCashDue": sum(out_inv[i]["newCashDue"] for i in ids), "difference": sum(diffs),
            "topUpCount": sum(1 for d in diffs if d > 0), "topUpTotal": sum(d for d in diffs if d > 0),
            "refundCount": sum(1 for d in diffs if d < 0), "refundTotal": -sum(d for d in diffs if d < 0),
        })
    return {"ok": True, "canApply": not bl, "blockers": bl, "investors": out_inv,
            "feeBefore": fee_before, "feeAfter": fee_after, "totals": tot}


# ---------------------------------------------------------------- waterfall

def hurdle_amount(C, h, n100):
    """halfUp(C * ((1 + h/1e4)^(n100/100) - 1)), exact.
    Whole years: exact Fraction power. Fractional years n = a/b: x = (base^a)^(1/b);
    estimate with 60-digit Decimal, then fix the integer m with exact tests
    (1 + (m - 1/2)/C)^b <= base^a < (1 + (m + 1/2)/C)^b."""
    base = Fraction(BP + h, BP)
    n = Fraction(n100, 100)
    if n.denominator == 1:
        return half_up(C * (base ** n.numerator - 1))
    a, b = n.numerator, n.denominator
    target = base ** a
    ctx = getcontext().copy()
    ctx.prec = 60
    est = ctx.power(ctx.divide(Decimal(BP + h), Decimal(BP)), ctx.divide(Decimal(a), Decimal(b)))
    m = int(ctx.multiply(Decimal(C), ctx.subtract(est, Decimal(1))).quantize(Decimal(1), rounding=ROUND_HALF_UP))
    m = max(m, 0)

    def lo_ok(m_):  # x >= 1 + (m_ - 1/2)/C
        t = 1 + Fraction(2 * m_ - 1, 2 * C)
        return t <= 0 or t ** b <= target

    def hi_ok(m_):  # x < 1 + (m_ + 1/2)/C
        return target < (1 + Fraction(2 * m_ + 1, 2 * C)) ** b

    while not lo_ok(m):
        m -= 1
    while not hi_ok(m):
        m += 1
    return m


def waterfall(case):
    holdings = case.get("holdings") or []
    ids = set()
    for h in holdings:
        if not isinstance(h.get("id"), str) or h["id"] in ids:
            raise Invalid("holding id")
        ids.add(h["id"])
        need_int(h.get("capital"), 1, MONEY_MAX)
    C = sum(h["capital"] for h in holdings)
    if C <= 0:
        raise Invalid("total capital must be > 0")
    G = need_int(case.get("proceeds"), 0, MONEY_MAX)
    E = case.get("exitCosts", 0)
    if E is None:
        E = 0
    need_int(E, 0, MONEY_MAX)
    n100 = need_int(case.get("years100"), 0, 5000)

    carry_cfg = case.get("carry") or {}
    mode = carry_cfg.get("mode")
    if mode == "fixed":
        if "tiers" in carry_cfg:
            raise Invalid("tiers in fixed mode")
        k = need_int(carry_cfg.get("k"), 0, BP)
        h = carry_cfg.get("h", 0)
        c = carry_cfg.get("c", 0)
        h = 0 if h is None else h
        c = 0 if c is None else c
        need_int(h, 0, BP)
        need_int(c, 0, BP)
        if h == 0 and c != 0:
            raise Invalid("catch-up without hurdle")
        if h > 0 and c > 0 and not (k < c <= BP):
            raise Invalid("catch-up must satisfy k < c <= 100%")
    elif mode == "tiered":
        for key in ("k", "h", "c"):
            if carry_cfg.get(key) is not None:
                raise Invalid("fixed-mode field in tiered mode")
        tiers = carry_cfg.get("tiers")
        if not isinstance(tiers, list) or not tiers:
            raise Invalid("tiers")
        prev = 100
        for idx, t in enumerate(tiers):
            need_int(t.get("rate"), 0, BP)
            up = t.get("upTo100")
            last = idx == len(tiers) - 1
            if last:
                if up is not None:
                    raise Invalid("last tier must be unbounded")
            else:
                need_int(up)
                if up <= prev:
                    raise Invalid("tier multiples must strictly increase and be > 1")
                prev = up
    else:
        raise Invalid("carry mode")

    zero = {
        "ok": True, "blockers": [], "shortfall": 0, "costsPaid": 0,
        "returnOfCapital": 0, "hurdlePaid": 0, "catchUpTranche": 0,
        "catchUpToLead": 0, "carry": 0, "investorsTotal": 0,
        "distributions": {hh["id"]: 0 for hh in holdings},
    }
    if E > G:
        zero["blockers"] = ["exit-cost-shortfall"]
        zero["shortfall"] = E - G
        zero["costsPaid"] = G
        return zero

    D = G - E
    roc = min(D, C)
    profit = D - roc
    hurdle_paid = 0
    tranche = 0
    to_lead_cu = 0
    carry = 0

    if mode == "fixed":
        remaining = profit
        if h > 0 and profit > 0:
            P = hurdle_amount(C, h, n100)
            hurdle_paid = min(remaining, P)
            remaining -= hurdle_paid
            if c > 0:
                Y = half_up(Fraction(k * hurdle_paid, c - k))
                tranche = min(remaining, Y)
                to_lead_cu = half_up(Fraction(tranche * c, BP))
                remaining -= tranche
        carry = to_lead_cu + half_up(Fraction(remaining * k, BP))
    else:
        prev_b = 0
        for idx, t in enumerate(tiers):
            if t["upTo100"] is None:
                band = max(profit - prev_b, 0)
            else:
                b = half_up(Fraction((t["upTo100"] - 100) * C, 100))
                band = min(max(profit - prev_b, 0), b - prev_b)
                prev_b = b
            carry += half_up(Fraction(band * t["rate"], BP))

    investors_total = D - carry
    split = largest_remainder(investors_total, [hh["capital"] for hh in holdings])
    return {
        "ok": True, "blockers": [], "shortfall": 0, "costsPaid": E,
        "returnOfCapital": roc, "hurdlePaid": hurdle_paid,
        "catchUpTranche": tranche, "catchUpToLead": to_lead_cu,
        "carry": carry, "investorsTotal": investors_total,
        "distributions": {hh["id"]: v for hh, v in zip(holdings, split)},
    }


# ---------------------------------------------------------------- reconcile

STOP = {"MR", "MRS", "MS", "DR", "LTD", "LIMITED", "LLP", "PLC", "AND", "THE"}


INVESTOR_REF = re.compile(r"[A-Za-z0-9]+(?:[ \-/_.][A-Za-z0-9]+){0,2}")


def norm_ref(s):
    return re.sub(r"[^A-Z0-9]", "", (s or "").upper())


ASCII_UPPER = str.maketrans("abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def ascii_upper(s):
    """Upper-case only a-z (PRD v0.7.2); no other case mapping."""
    return (s or "").translate(ASCII_UPPER)


def tokens(s):
    """Separators are only ASCII chars other than A-Z/a-z/0-9 (PRD v0.7.2);
    every non-ASCII code point is part of a token."""
    out, cur = [], []
    for ch in ascii_upper(s):
        if ord(ch) > 127 or ch.isalnum():  # ASCII alnum or any non-ASCII char
            cur.append(ch)
        elif cur:
            out.append("".join(cur))
            cur = []
    if cur:
        out.append("".join(cur))
    return out


def concats(toks):
    out = []
    for i in range(len(toks)):
        for L in (1, 2, 3):
            if i + L <= len(toks):
                out.append("".join(toks[i:i + L]))
    return out


def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def digits_int(s):
    d = "".join(ch for ch in (s or "") if "0" <= ch <= "9")  # ASCII digits only
    return int(d) if d else None


def name_words(s):
    s = "".join(ch if (ord(ch) > 127 or "A" <= ch <= "Z") else " " for ch in ascii_upper(s))
    return [w for w in s.split(" ") if w and w not in STOP]


def word_ok(a, b):
    if a == b:
        return True
    if len(a) == 1 and b[0] == a:
        return True
    if len(b) == 1 and a[0] == b:
        return True
    return False


def max_matching(A, B):
    match_b = [-1] * len(B)

    def try_a(i, seen):
        for j in range(len(B)):
            if j in seen or not word_ok(A[i], B[j]):
                continue
            seen.add(j)
            if match_b[j] == -1 or try_a(match_b[j], seen):
                match_b[j] = i
                return True
        return False

    return sum(1 for i in range(len(A)) if try_a(i, set()))


def name_similarity(a, b):
    A, B = name_words(a), name_words(b)
    if not A or not B:
        return Fraction(0)
    return Fraction(max_matching(A, B), max(len(A), len(B)))


def parse_date(s):
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s or "")
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", s or "")
    if m:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    raise Invalid("date %r" % (s,))


def score_out(fr):
    q = (Decimal(fr.numerator) / Decimal(fr.denominator)).quantize(
        Decimal("0.0001"), rounding=ROUND_HALF_UP)
    return float(q)


def reconcile(case):
    as_of = parse_date(case["asOf"])
    threshold = case.get("thresholdDays", 10)
    commitments = case.get("commitments") or []
    lines = case.get("lines") or []
    decisions = case.get("decisions") or {}
    if len(commitments) > 500 or len(lines) > 2000:
        raise Invalid("size limits (I-08)")
    for c in commitments:
        ref = c.get("reference")
        if not isinstance(ref, str) or not INVESTOR_REF.fullmatch(ref):
            raise Invalid("investor reference %r" % (ref,))
    cnorm = [norm_ref(c.get("reference")) for c in commitments]
    if any(not 3 <= len(x) <= 20 for x in cnorm) or len(set(cnorm)) != len(cnorm):
        raise Invalid("normalised reference length 3-20 and unique")
    cdigits = [digits_int(c.get("reference")) for c in commitments]

    # v0.8 (C-REC-7, C-ALL-11): optional withdrawn ids and effective cash due
    extended = "withdrawn" in case or "adjustedCashDue" in case
    cids = [c.get("id") for c in commitments]
    withdrawn = case.get("withdrawn") or []
    adjusted = case.get("adjustedCashDue") or {}
    if not isinstance(withdrawn, list) or len(set(withdrawn)) != len(withdrawn) or not set(withdrawn) <= set(cids):
        raise Invalid("withdrawn ids")
    if not isinstance(adjusted, dict) or not set(adjusted) <= set(cids):
        raise Invalid("adjustedCashDue ids")
    for v in adjusted.values():
        need_int(v, 1, MONEY_MAX)
    withdrawn = set(withdrawn)

    def eff_due(c):
        return adjusted.get(c["id"], c["cashDue"])

    # suspected duplicates: no txnId, identical (date, amount, payer, reference)
    keyc = {}
    for ln in lines:
        if ln.get("txnId") is None:
            key = (ln.get("date"), ln.get("amount"), ln.get("payer"), ln.get("reference"))
            keyc[key] = keyc.get(key, 0) + 1

    def is_dup(ln):
        if ln.get("txnId") is not None:
            return False
        return keyc[(ln.get("date"), ln.get("amount"), ln.get("payer"), ln.get("reference"))] > 1

    info = {}
    # pass 1: skipped / future / decisions / auto
    for ln in lines:
        lid = ln["id"]
        d = parse_date(ln["date"])
        dup = is_dup(ln)
        rec = {"status": None, "assignedTo": None, "suspectedDuplicate": dup,
               "candidates": [], "_date": d}
        info[lid] = rec
        if ln["amount"] <= 0:
            rec["status"] = "skipped"
            continue
        if d > as_of:
            rec["status"] = "future"
            continue
        dec = decisions.get(lid)
        if dec is not None:
            if dec.get("reject"):
                rec["status"] = "rejected"
            else:
                rec["status"] = "confirmed"
                rec["assignedTo"] = dec["assign"]
            continue
        cc = set(concats(tokens(ln.get("reference"))))
        exact = [i for i, nr in enumerate(cnorm) if nr in cc]
        rec["_exact"] = exact
        rec["_cc"] = cc
        if len(exact) == 1 and not dup:
            rec["status"] = "auto"
            rec["assignedTo"] = commitments[exact[0]]["id"]

    booked = {c["id"]: 0 for c in commitments}
    for ln in lines:
        rec = info[ln["id"]]
        if rec["status"] in ("auto", "confirmed"):
            booked[rec["assignedTo"]] = booked.get(rec["assignedTo"], 0) + ln["amount"]

    # pass 2: candidates for remaining lines
    for ln in lines:
        rec = info[ln["id"]]
        if rec["status"] is not None:
            continue
        cc = rec["_cc"]
        exact = set(rec["_exact"])
        run_digits = {digits_int(x) for x in cc} - {None}
        scored = []
        for i, c in enumerate(commitments):
            s = Fraction(0)
            if i in exact:
                s += Fraction(6, 10)
            else:
                partial = any(edit_distance(x, cnorm[i]) <= 1 for x in cc)
                if not partial and cdigits[i] is not None and cdigits[i] in run_digits:
                    partial = True
                if partial:
                    s += Fraction(1, 4)
            s += name_similarity(ln.get("payer"), c.get("name")) * Fraction(3, 10)
            due = eff_due(c)
            owe = due - booked.get(c["id"], 0)
            if ln["amount"] == due or (owe > 0 and ln["amount"] == owe):
                s += Fraction(1, 4)
            s = min(s, Fraction(1))
            if s >= Fraction(3, 10):
                scored.append((s, i))
        scored.sort(key=lambda t: (-t[0], t[1]))
        top = scored[:3]
        if top:
            rec["status"] = "suggested"
            rec["candidates"] = [{"id": commitments[i]["id"], "score": score_out(s)} for s, i in top]
        else:
            rec["status"] = "unmatched"

    bank = booked_total = 0
    aged = []
    for ln in lines:
        rec = info[ln["id"]]
        st = rec["status"]
        if st in ("skipped", "future"):
            continue
        bank += ln["amount"]
        if st in ("auto", "confirmed"):
            booked_total += ln["amount"]
        elif (as_of - rec["_date"]).days > threshold:
            aged.append(ln["id"])

    out_c = {}
    for c in commitments:
        r = booked.get(c["id"], 0)
        diff = r - eff_due(c)
        if c["id"] in withdrawn:
            st = "withdrawn"
        elif r == 0:
            st = "outstanding"
        elif diff == 0:
            st = "paid"
        elif diff > 0:
            st = "overpaid"
        else:
            st = "partial"
        out_c[c["id"]] = {"received": r, "difference": diff, "status": st}
        if extended:
            out_c[c["id"]].update({"cashDue": eff_due(c), "withdrawn": c["id"] in withdrawn})

    out_l = {}
    for ln in lines:
        rec = info[ln["id"]]
        out_l[ln["id"]] = {k: rec[k] for k in ("status", "assignedTo", "suspectedDuplicate", "candidates")}

    result = {
        "lines": out_l,
        "commitments": out_c,
        "totals": {"bank": bank, "booked": booked_total, "unbooked": bank - booked_total},
        "aged": sorted(aged),
    }
    if extended:
        refunds, chase, handoff = [], [], {}
        for c in commitments:
            cid, r, due = c["id"], booked.get(c["id"], 0), eff_due(c)
            if cid in withdrawn:
                if r > 0:  # C-REC-7: all received, reason Withdrawn; none if nothing received
                    refunds.append({"id": cid, "amount": r, "reason": "withdrawn"})
                continue
            if r > due:  # C-REC-6
                refunds.append({"id": cid, "amount": r - due, "reason": "overpayment"})
            if r < due:  # R-REC-09 / R-REC-10.1: unpaid or part-paid, not withdrawn
                chase.append({"id": cid, "outstanding": due - r})
            handoff[cid] = min(r, due)
        refund_total = sum(x["amount"] for x in refunds)
        # C-REC-7 identity, computed independently of the refund list
        identity = (sum(booked.get(c["id"], 0) for c in commitments if c["id"] in withdrawn)
                    + sum(max(0, booked.get(c["id"], 0) - eff_due(c)) for c in commitments if c["id"] not in withdrawn))
        if identity != refund_total:
            raise ArithmeticFail("refund total identity")
        w_refund = sum(x["amount"] for x in refunds if x["reason"] == "withdrawn")
        result.update({
            "refunds": refunds,
            "refundTotal": refund_total,
            "receivable": sum(eff_due(c) for c in commitments if c["id"] not in withdrawn),
            "withdrawnSummary": {"count": len(withdrawn), "refund": w_refund},
            "chase": chase,
            "handoff": handoff,
            "checks": {"refundIdentity": identity == refund_total},
        })
    return result


# ---------------------------------------------------------------- entry

def run(case):
    kind = case.get("kind")
    try:
        if kind == "allocation":
            return allocation(case)
        if kind == "waterfall":
            return waterfall(case)
        if kind == "reconcile":
            return reconcile(case)
        if kind == "feePayerChange":
            return fee_payer_change(case)
    except (Invalid, KeyError, TypeError, AttributeError):
        return {"ok": False}
    return {"ok": False}


def main():
    if len(sys.argv) != 2:
        sys.stderr.write("usage: oracle.py <case.json>\n")
        sys.exit(2)
    with open(sys.argv[1], encoding="utf-8") as fh:
        case = json.load(fh)
    print(json.dumps(run(case), sort_keys=True))


if __name__ == "__main__":
    main()
