#!/usr/bin/env python3
"""Self-check the oracle against the hand calculations in docs/04_TEST_PLAN.md
(§2.3 allocation, §2.4 waterfall, §3 sample deal, plus a few §2.2 reconcile rows).
Usage: python3 scripts/oracle/selfcheck.py"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from oracle import run  # noqa: E402

PASSED = 0
FAILED = []


def check(name, cond, detail=""):
    global PASSED
    if cond:
        PASSED += 1
    else:
        FAILED.append("%s %s" % (name, detail))
        print("FAIL", name, detail)


def eq(name, got, want):
    check(name, got == want, "got %r want %r" % (got, want))


GBP1 = 1000000  # £1.00 in price micros


def alloc(investors, fees=(), basis="deducted", minimum=0, cap=None, price=GBP1):
    return run({
        "kind": "allocation", "feeBasis": basis, "minimum": minimum, "cap": cap,
        "priceMicros": price, "fees": list(fees),
        "investors": [{"id": i, "received": r, "scheme": s} for i, r, s in investors],
    })


PF3 = {"id": "pf", "kind": "percent", "value": 300, "payer": "investors"}

# ---------------------------------------------------------------- §2.3 allocation
r = alloc([("A", 100000, "none")])
eq("ALL-01 I", r["investors"]["A"]["invested"], 100000)
eq("ALL-01 shares", r["investors"]["A"]["microShares"], 1000000000)
eq("ALL-01 refund", r["investors"]["A"]["refund"], 0)

r = alloc([("A", 1000000, "none")], [PF3])
eq("ALL-02", (r["investors"]["A"]["invested"], r["investors"]["A"]["fees"], r["investors"]["A"]["refund"]),
   (970000, {"pf": 30000}, 0))

r = alloc([("A", 1030000, "none")], [PF3], basis="onTop")
eq("ALL-03", (r["investors"]["A"]["invested"], r["investors"]["A"]["fees"], r["investors"]["A"]["refund"]),
   (1000000, {"pf": 30000}, 0))

r = alloc([("A", 500000, "SEIS")], price=2413700)
a = r["investors"]["A"]
eq("ALL-05", (a["invested"], a["microShares"], a["claimableShares"], a["claimableAmount"]),
   (500000, 2071508472, 2071, 499877))
eq("ALL-05 unclaimable", a["invested"] - a["claimableAmount"], 123)

r = alloc([("A", 100000, "none")], minimum=100000, price=2413700)
eq("ALL-06", (r["investors"]["A"]["participating"], r["investors"]["A"]["invested"],
              r["investors"]["A"]["microShares"]), (True, 100000, 414301694))

r = alloc([("A", 90000, "none")], [PF3], minimum=100000)
eq("ALL-07", (r["investors"]["A"]["participating"], r["investors"]["A"]["refund"], r["investors"]["A"]["fees"]),
   (False, 90000, {}))
eq("ALL-07/14 blocker", r["blockers"], ["no-participants"])

r = alloc([("A", 102000, "none")], [PF3], basis="onTop", minimum=100000)
eq("ALL-08", (r["investors"]["A"]["participating"], r["investors"]["A"]["refund"]), (False, 102000))

r = alloc([("A", 400000, "none"), ("B", 200000, "none")], cap=300000)
eq("ALL-09", [(r["investors"][i]["invested"], r["investors"][i]["refund"]) for i in "AB"],
   [(200000, 200000), (100000, 100000)])
eq("ALL-09 blockers", r["blockers"], [])

r = alloc([("A", 100000, "none"), ("B", 100000, "none")], minimum=100000, cap=150000)
eq("ALL-10", ([r["investors"][i]["invested"] for i in "AB"], r["blockers"]),
   ([75000, 75000], ["scale-back-below-minimum"]))

fees11 = [{"id": "admin", "kind": "perInvestor", "value": 1000, "payer": "investors"},
          {"id": "kyc", "kind": "perInvestor", "value": 500, "payer": "investors"}]
r = alloc([("A", 100000, "none"), ("B", 200000, "none")], fees11)
eq("ALL-11 fees", [r["investors"][i]["fees"] for i in "AB"], [{"admin": 1000, "kyc": 500}] * 2)
eq("ALL-11 totals", r["feeTotals"], {"admin": 2000, "kyc": 1000})
eq("ALL-11 I", [r["investors"][i]["invested"] for i in "AB"], [98500, 198500])

r = alloc([("A", 100000, "none")], [{"id": "legal", "kind": "fixed", "value": 150000, "payer": "company"}])
eq("ALL-13", r["blockers"], ["company-fees-exceed"])

r = alloc([])
eq("ALL-14 empty", r["blockers"], ["no-participants"])

r = alloc([("A", 1000000, "none")], [{"id": "legal", "kind": "fixed", "value": 150000, "payer": "company"},
                                     {"id": "lead", "kind": "percent", "value": 200, "payer": "lead"}])
eq("ALL-15", (r["wire"], r["leadInvoice"], r["companyFees"], r["blockers"]), (850000, 20000, 150000, []))

ok17 = True
for rec in range(1000, 1400):
    r = alloc([("A", rec, "none")], [{"id": "pf", "kind": "percent", "value": 350, "payer": "investors"}],
              price=333333)
    a = r["investors"]["A"]
    if a["refund"] < 0 or a["invested"] + sum(a["fees"].values()) + a["refund"] != rec:
        ok17 = False
check("ALL-17 invariant 10.00..13.99", ok17)

r = alloc([("A", 1000, "none"), ("B", 10000, "none")],
          [{"id": "fx", "kind": "perInvestor", "value": 1000, "payer": "investors"}])
eq("ALL-21 A", (r["investors"]["A"]["participating"], r["investors"]["A"]["refund"], r["investors"]["A"]["fees"]),
   (False, 1000, {}))
eq("ALL-21 B", (r["investors"]["B"]["invested"], r["investors"]["B"]["fees"]), (9000, {"fx": 1000}))

fees22 = [{"id": "f%d" % i, "kind": "percent", "value": 100, "payer": "investors"} for i in range(5)]
r = alloc([("A", 53, "none")], fees22, price=10000)
eq("ALL-22", (r["investors"]["A"]["invested"], r["investors"]["A"]["fees"], r["investors"]["A"]["refund"]),
   (48, {"f%d" % i: 1 for i in range(5)}, 0))

eq("ALL invalid p>=100%", alloc([("A", 100, "none")], [{"id": "x", "kind": "percent", "value": 10000,
                                                       "payer": "investors"}]), {"ok": False})
eq("ALL invalid investor fixed", alloc([("A", 100, "none")], [{"id": "x", "kind": "fixed", "value": 10,
                                                              "payer": "investors"}]), {"ok": False})

# ---------------------------------------------------------------- §3 sample: allocation
sample_alloc = [("amelia", 1000000, "SEIS"), ("ben", 500000, "EIS"), ("chloe", 2000000, "none"),
                ("david", 200000, "SEIS"), ("elena", 1500000, "EIS"), ("farhan", 1000000, "EIS"),
                ("grace", 2500000, "none"), ("hugo", 500000, "SEIS"), ("isla", 100000, "none"),
                ("james", 0, "EIS"), ("kavya", 750000, "SEIS"), ("lucas", 300000, "none")]
r = alloc(sample_alloc, [{"id": "platform", "kind": "percent", "value": 300, "payer": "investors"},
                         {"id": "legal", "kind": "fixed", "value": 150000, "payer": "company"}],
          minimum=100000, cap=15000000, price=2413700)
eq("S-ALL received total", sum(x[1] for x in sample_alloc), 10350000)
eq("S-ALL participants", sum(1 for v in r["investors"].values() if v["participating"]), 11)
eq("S-ALL totals", (r["totalInvested"], r["feeTotals"], r["companyFees"], r["wire"], r["blockers"]),
   (10039500, {"platform": 310500, "legal": 150000}, 150000, 9889500, []))
eq("S-ALL refunds", sum(v["refund"] for v in r["investors"].values()), 0)
for iid, rec, _ in sample_alloc:
    if rec:
        v = r["investors"][iid]
        check("S-ALL %s 0.97/0.03" % iid, v["invested"] * 100 == rec * 97 and v["fees"]["platform"] * 100 == rec * 3)
am, dv = r["investors"]["amelia"], r["investors"]["david"]
eq("S-ALL amelia", (am["invested"], am["microShares"], am["claimableShares"], am["claimableAmount"]),
   (970000, 4018726436, 4018, 969824))
eq("S-ALL david", (dv["invested"], dv["microShares"], dv["claimableShares"], dv["claimableAmount"]),
   (194000, 803745287, 803, 193820))
eq("S-ALL isla", r["investors"]["isla"]["invested"], 97000)
check("S-ALL james out", r["investors"]["james"]["participating"] is False)
holdings = [{"id": k, "capital": v["invested"]} for k, v in r["investors"].items() if v["participating"]]


# ---------------------------------------------------------------- §2.4 waterfall
def wf(proceeds, exit_costs=0, years100=500, k=2000, h=0, c=0, tiers=None, hold=None):
    carry = {"mode": "tiered", "tiers": tiers} if tiers else {"mode": "fixed", "k": k, "h": h, "c": c}
    return run({"kind": "waterfall",
                "holdings": hold or [{"id": "a", "capital": 6000000}, {"id": "b", "capital": 4000000}],
                "proceeds": proceeds, "exitCosts": exit_costs, "years100": years100, "carry": carry})


r = wf(30000000)
eq("DIS-01", (r["carry"], r["distributions"]), (4000000, {"a": 15600000, "b": 10400000}))
eq("DIS-19 profit", (r["distributions"]["a"] - 6000000, r["distributions"]["b"] - 4000000), (9600000, 6400000))
r = wf(8000000)
eq("DIS-02", (r["carry"], r["investorsTotal"], r["returnOfCapital"]), (0, 8000000, 8000000))
eq("DIS-03", wf(30000000, exit_costs=1000000)["carry"], 3800000)
r = wf(30000000, h=800, c=10000)
eq("DIS-04", (r["hurdlePaid"], r["catchUpTranche"], r["catchUpToLead"], r["carry"]),
   (4693281, 1173320, 1173320, 4000000))
eq("DIS-04 residual", r["carry"] - r["catchUpToLead"], 2826680)
eq("DIS-05", wf(30000000, h=800, c=0)["carry"], 3061344)
r = wf(30000000, h=800, c=5000)
eq("DIS-06", (r["catchUpTranche"], r["catchUpToLead"], r["carry"] - r["catchUpToLead"], r["carry"]),
   (3128854, 1564427, 2435573, 4000000))
eq("DIS-07", wf(14000000, h=800, c=10000)["carry"], 0)
r = wf(30000000, h=800, c=0, years100=250)
eq("DIS-08", (r["hurdlePaid"], r["carry"]), (2121584, 3575683))
T23 = [{"upTo100": 300, "rate": 2000}, {"upTo100": None, "rate": 3000}]
eq("DIS-09", wf(50000000, tiers=T23)["carry"], 10000000)
eq("DIS-10a", wf(31000000, exit_costs=1000000, tiers=T23)["carry"], 4000000)
eq("DIS-10b", wf(31001000, exit_costs=1000000, tiers=T23)["carry"], 4000300)
r = wf(100, k=0, hold=[{"id": "x", "capital": 1}, {"id": "y", "capital": 1}, {"id": "z", "capital": 1}])
eq("DIS-12", r["distributions"], {"x": 34, "y": 33, "z": 33})
r = wf(100, exit_costs=200)
eq("DIS-13", (r["blockers"], r["shortfall"], r["costsPaid"], r["carry"], r["distributions"]),
   (["exit-cost-shortfall"], 100, 100, 0, {"a": 0, "b": 0}))
eq("DIS-14 zero capital", wf(100, hold=[{"id": "a", "capital": 0}]), {"ok": False})
eq("DIS-14 c without h", wf(100, h=0, c=5000), {"ok": False})
eq("DIS-14 c <= k", wf(100, h=800, c=2000), {"ok": False})
eq("DIS-14 tiers not increasing", wf(100, tiers=[{"upTo100": 300, "rate": 2000}, {"upTo100": 200, "rate": 2500},
                                                 {"upTo100": None, "rate": 3000}]), {"ok": False})
r = wf(16000000, h=800, c=5000)
eq("DIS-16", (r["catchUpTranche"], r["catchUpToLead"], r["carry"], r["investorsTotal"]),
   (1306719, 653360, 653360, 15346640))
eq("DIS-17", [wf(g, tiers=T23)["carry"] for g in (29999999, 30000000, 30000001)], [4000000] * 3)
r = wf(2, tiers=[{"upTo100": 150, "rate": 10000}, {"upTo100": None, "rate": 10000}],
       hold=[{"id": "a", "capital": 1}])
eq("DIS-18", (r["carry"], r["investorsTotal"]), (1, 1))
bad = run({"kind": "waterfall", "holdings": [{"id": "a", "capital": 100}], "proceeds": 1000, "exitCosts": 0,
           "years100": 500, "carry": {"mode": "tiered", "h": 800, "tiers": T23}})
eq("DIS-20", bad, {"ok": False})
r = wf(2900, k=0, hold=[{"id": "a", "capital": 19}, {"id": "b", "capital": 10}])
eq("DIS-22", r["distributions"], {"a": 1900, "b": 1000})
r = wf(2900, k=0, hold=[{"id": "a", "capital": 19}, {"id": "b", "capital": 20}])
eq("DIS-21a", r["distributions"], {"a": 1413, "b": 1487})

r = run({"kind": "waterfall", "holdings": [{"id": "a", "capital": 5000}], "proceeds": 5001, "exitCosts": 0,
         "years100": 100, "carry": {"mode": "fixed", "k": 10000, "h": 1, "c": 0}})
eq("REVIEW hurdle exact half-penny", (r["hurdlePaid"], r["carry"], r["distributions"]), (1, 0, {"a": 5001}))
from oracle import hurdle_amount  # noqa: E402
eq("REVIEW hurdle 1.21^0.5 exact", hurdle_amount(5, 2100, 50), 1)  # 5 * 0.1 = 0.5 -> 1
eq("REVIEW hurdle 2.5y", hurdle_amount(10000000, 800, 250), 2121584)

# ---------------------------------------------------------------- §3 sample: waterfall
r = run({"kind": "waterfall", "holdings": holdings, "proceeds": 39000000, "exitCosts": 450000,
         "years100": 600, "carry": {"mode": "fixed", "k": 2000, "h": 800, "c": 10000}})
eq("S-DIS", (r["returnOfCapital"], r["hurdlePaid"], r["catchUpTranche"], r["catchUpToLead"],
             r["carry"] - r["catchUpToLead"], r["carry"], r["investorsTotal"]),
   (10039500, 5891925, 1472981, 1472981, 4229119, 5702100, 32847900))
eq("S-DIS split sum", sum(r["distributions"].values()), 32847900)

# ---------------------------------------------------------------- §3 sample: reconcile
names = [("amelia", "Amelia Hart", 1000000), ("ben", "Ben Okafor", 500000), ("chloe", "Chloe Martin", 2000000),
         ("david", "David Kim", 250000), ("elena", "Elena Rossi", 1500000), ("farhan", "Farhan Malik", 1000000),
         ("grace", "Grace Liu", 2500000), ("hugo", "Hugo Bernard", 500000), ("isla", "Isla Campbell", 100000),
         ("james", "James Whitfield", 2000000), ("kavya", "Kavya Iyer", 750000), ("lucas", "Lucas Meyer", 300000)]
commitments = [{"id": i, "name": n, "reference": "NW-%03d" % (k + 1), "cashDue": d}
               for k, (i, n, d) in enumerate(names)]
L = [("t01", "10-06", 1000000, "A HART", "NW-001"), ("t02", "10-06", 500000, "B OKAFOR", "NW002 NORTHWIND"),
     ("t03", "10-07", 2000000, "CHLOE MARTIN", ""), ("t04", "10-07", 200000, "D KIM", "NW-004"),
     ("t05", "10-08", 1500000, "ROSSI FAMILY OFFICE LTD", "NORTHWIND SEED"),
     ("t06", "10-08", 1000000, "F MALIK", "NW-006"), ("t07", "10-09", 2500000, "GRACE LIU", "NW-007"),
     ("t08", "10-09", 500000, "H BERNARD", "NW-008"), ("t09", "10-10", 500000, "H BERNARD", "NW-008"),
     ("t10", "10-10", 100000, "ISLA CAMPBELL", "NW-009"), ("t11", "10-03", 234000, "WESTBRIDGE SUPPLIES", "INV 4471"),
     ("t12", "10-14", 750000, "K IYER", "NW 11"), ("t13", "10-15", 300000, "L MEYER", "NW-012"),
     ("t14", "10-15", 400000, "SAM PATEL", "NW-0019"), ("t15", "10-15", -4500, "BANK CHARGE", "FEE"),
     ("t16", "10-18", 300000, "J WHITFIELD", "NW-010")]
lines = [{"id": i, "txnId": i, "date": "2026-" + d, "amount": a, "payer": p, "reference": ref}
         for i, d, a, p, ref in L]


def rec(decisions=None, lines_=None, comms=None, as_of="2026-10-16", thr=10):
    return run({"kind": "reconcile", "asOf": as_of, "thresholdDays": thr, "commitments": comms or commitments,
                "lines": lines_ if lines_ is not None else lines, "decisions": decisions or {}})


r = rec()
st = {k: v["status"] for k, v in r["lines"].items()}
for t in ("t01", "t02", "t04", "t06", "t07", "t08", "t09", "t10", "t13"):
    eq("S-REC %s auto" % t, st[t], "auto")
eq("S-REC t03", r["lines"]["t03"]["candidates"][0], {"id": "chloe", "score": 0.55})
eq("S-REC t05", r["lines"]["t05"]["candidates"][0], {"id": "elena", "score": 0.35})
eq("S-REC t12", r["lines"]["t12"]["candidates"][0], {"id": "kavya", "score": 0.8})
eq("S-REC suggested", sorted(k for k, v in st.items() if v == "suggested"), ["t03", "t05", "t12"])
eq("S-REC unmatched", sorted(k for k, v in st.items() if v == "unmatched"), ["t11", "t14"])
eq("S-REC t15/t16", (st["t15"], st["t16"]), ("skipped", "future"))
eq("S-REC totals", r["totals"], {"bank": 11484000, "booked": 6600000, "unbooked": 4884000})
eq("S-REC aged", r["aged"], ["t11"])
cs = {k: (v["status"], v["difference"]) for k, v in r["commitments"].items()}
for k in ("amelia", "ben", "farhan", "grace", "isla", "lucas"):
    eq("S-REC %s paid" % k, cs[k], ("paid", 0))
eq("S-REC david", cs["david"], ("partial", -50000))
eq("S-REC hugo", cs["hugo"], ("overpaid", 500000))
for k in ("chloe", "elena", "kavya", "james"):
    eq("S-REC %s outstanding" % k, cs[k][0], "outstanding")

r = rec({"t03": {"assign": "chloe"}, "t05": {"assign": "elena"}, "t12": {"assign": "kavya"},
         "t11": {"reject": True}, "t14": {"reject": True}})
eq("S-REC after decisions totals", r["totals"], {"bank": 11484000, "booked": 10850000, "unbooked": 634000})
eq("S-REC after decisions aged", r["aged"], ["t11"])
carried = {k: min(v["received"], c["cashDue"]) for c in commitments for k, v in r["commitments"].items()
           if c["id"] == k}
eq("S-REC carry-in", (carried["hugo"], carried["david"], carried["james"], sum(carried.values())),
   (500000, 200000, 0, 10350000))

# ---------------------------------------------------------------- §2.2 reconcile spot checks
base = [{"id": "john", "name": "John Smith", "reference": "NW-001", "cashDue": 500000},
        {"id": "priya", "name": "Priya Shah", "reference": "NW-002", "cashDue": 1000000},
        {"id": "tom", "name": "Tom Okafor", "reference": "NW-003", "cashDue": 250000},
        {"id": "ana", "name": "Ana Lima", "reference": "NW-010", "cashDue": 100000}]


def one(amount, payer, ref, txn="x", d="2026-10-10", decisions=None):
    return rec(decisions, [{"id": "x", "txnId": txn, "date": d, "amount": amount, "payer": payer,
                            "reference": ref}], base, as_of="2026-10-12")["lines"]["x"]


for ref in ("NW-001", "nw 001", "NW001 SPV"):
    eq("REC-01 %s" % ref, (one(123, "", ref)["status"], one(123, "", ref)["assignedTo"]), ("auto", "john"))
check("REC-02", one(123, "", "NW-0019")["status"] != "auto")
eq("REC-03", one(123, "", "NW-010")["assignedTo"], "ana")
x = one(123, "", "NW-001 NW-002")
eq("REC-04", (x["status"], [c["id"] for c in x["candidates"]]), ("suggested", ["john", "priya"]))
eq("REC-05", one(1000000, "PRIYA SHAH", "")["candidates"][0], {"id": "priya", "score": 0.55})
eq("REC-07", rec({"x": {"assign": "tom"}}, [{"id": "x", "txnId": "x", "date": "2026-10-10", "amount": 1000000,
                                            "payer": "PRIYA SHAH", "reference": ""}], base,
                 as_of="2026-10-12")["commitments"]["tom"]["difference"], 750000)
eq("REC-11", one(100000, "UNKNOWN", "")["status"], "unmatched")
eq("REC-13", one(250000, "T OKAFOR", "NW 3")["candidates"][0], {"id": "tom", "score": 0.8})
eq("REC-12a", one(1, "J SMITH", "")["candidates"][0]["score"], 0.3)
eq("REC-12b", one(1, "MR JOHN SMITH", "")["candidates"][0]["score"], 0.3)
eq("REC-12c Okafor Holdings", one(250000, "Okafor Holdings Ltd", "")["candidates"][0], {"id": "tom", "score": 0.4})
dup = [{"id": i, "txnId": None, "date": "2026-10-10", "amount": 500000, "payer": "J SMITH", "reference": "NW-001"}
       for i in ("d1", "d2")]
r = rec(None, dup, base, as_of="2026-10-12")
eq("REC-16", [(r["lines"][i]["status"] != "auto", r["lines"][i]["suspectedDuplicate"]) for i in ("d1", "d2")],
   [(True, True)] * 2)
r = rec(None, [{"id": "a", "txnId": "a", "date": "2026-10-01", "amount": 999, "payer": "", "reference": ""},
               {"id": "b", "txnId": "b", "date": "2026-10-02", "amount": 999, "payer": "", "reference": ""},
               {"id": "c", "txnId": "c", "date": "2026-10-03", "amount": 999, "payer": "", "reference": ""}],
        base, as_of="2026-10-12")
eq("REC-18", r["aged"], ["a"])
four = [{"id": "j%d" % i, "name": "John Smith", "reference": "JS-%03d" % i, "cashDue": 100} for i in range(4)]
x = rec(None, [{"id": "x", "txnId": "x", "date": "2026-10-10", "amount": 7, "payer": "J SMITH", "reference": ""}],
        four, as_of="2026-10-12")["lines"]["x"]
eq("REC-25", x["candidates"], [{"id": "j%d" % i, "score": 0.3} for i in range(3)])
x = rec(None, [{"id": "x", "txnId": "x", "date": "2026-10-10", "amount": 7, "payer": "J JOHN", "reference": ""}],
        [{"id": "jj", "name": "JOHN JAMES", "reference": "AB-1", "cashDue": 100}], as_of="2026-10-12")["lines"]["x"]
eq("REC-28", x["candidates"], [{"id": "jj", "score": 0.3}])

x = rec(None, [{"id": "x", "txnId": "x", "date": "2026-10-10", "amount": 10000, "payer": "UNKNOWN",
                "reference": "XX 11 INV 4471"}], [{"id": "n", "name": "Nora Wells", "reference": "NW-011",
                                                  "cashDue": 10000}], as_of="2026-10-12")["lines"]["x"]
eq("REVIEW partial by run digits", (x["status"], x["candidates"]), ("suggested", [{"id": "n", "score": 0.5}]))

from oracle import name_similarity  # noqa: E402
ss = [{"id": "s", "name": "Sam Stone", "reference": "SS-001", "cashDue": 10000}]
for memo in ("\u00df001", "Payment SS001\u00c9"):
    x = rec(None, [{"id": "x", "txnId": "x", "date": "2026-10-10", "amount": 1, "payer": "", "reference": memo}],
            ss, as_of="2026-10-12")["lines"]["x"]
    check("v0.7.2 token %r not exact" % memo, x["status"] != "auto" and x["candidates"] == [], repr(x))
eq("v0.7.2 J.A. SMITH", name_similarity("J.A. SMITH", "John Andrew Smith"), 1)
eq("v0.7.2 SMITH,JOHN", name_similarity("SMITH,JOHN", "John Smith"), 1)

eq("v0.7.2 ref E-acute invalid", rec(None, [], [{"id": "e", "name": "Eve", "reference": "\u00c9001",
                                                  "cashDue": 100}], as_of="2026-10-12"), {"ok": False})
eq("v0.7.2 21 fees invalid", alloc([("A", 100000, "none")],
                                   [{"id": "f%d" % i, "kind": "fixed", "value": 1, "payer": "lead"} for i in range(21)]),
   {"ok": False})
r = alloc([("i%d" % i, 100000000000, "none") for i in range(500)],
          [{"id": "l%d" % i, "kind": "percent", "value": 10000, "payer": "lead"} for i in range(20)])
eq("v0.7.2 20 fees x 500 max", (r["ok"], r["totalInvested"], r["leadInvoice"]),
   (True, 50000000000000, 1000000000000000))

from oracle import tokens, name_words, digits_int, edit_distance  # noqa: E402
eq("v0.7.2b SS001E-acute", tokens("SS001\u00c9"), ["SS001\u00c9"])
eq("v0.7.2b en dash", tokens("NW-001\u2013X"), ["NW", "001\u2013X"])
eq("v0.7.2b Ref NW001 U+01A4", tokens("Ref NW001 \u01a4"), ["REF", "NW001", "\u01a4"])
eq("v0.7.2b Jose Garcia", name_words("Jos\u00e9 Garc\u00eda"), ["JOS\u00e9", "GARC\u00edA"])
eq("v0.7.2b J.A. SMITH", name_words("J.A. SMITH"), ["J", "A", "SMITH"])
eq("v0.7.2b non-ASCII digits ignored", digits_int("NW \u0661\u0662 7"), 7)
eq("v0.7.2b edit distance by code point", edit_distance("NW001\U0001F600", "NW001"), 1)

print("selfcheck: %d passed, %d failed" % (PASSED, len(FAILED)))
sys.exit(1 if FAILED else 0)
