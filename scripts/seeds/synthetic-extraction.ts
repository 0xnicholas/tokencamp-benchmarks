import type { ExtractionExpectedOutcome, ExtractionInitialState } from "../../src/core/datasets";

/**
 * In-house synthetic extraction generator (ADR-0003: 150 instances, "in-house
 * + ExtractBench" seeds). Deterministic: one seeded PRNG per instance, no
 * clock and no network, so a re-freeze reproduces the file byte-for-byte.
 *
 * Each instance is a rendered business document (a text "page" with field
 * labels, tables, and distractor values) plus the golden key→value map the
 * `golden_fields_exact` verifier checks (trimmed, case-sensitive strings).
 */

export const SYNTHETIC_SEED = 20261126;
export const SYNTHETIC_PER_TEMPLATE = 30;

export interface SyntheticInstance {
  readonly id: string;
  readonly template: string;
  readonly initial_state: ExtractionInitialState;
  readonly expected_outcome: ExtractionExpectedOutcome;
}

/** mulberry32: 32-bit PRNG, stable across engines — the freeze's only randomness. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;

function pick<T>(rand: Rand, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function int(rand: Rand, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

function amount(rand: Rand, min: number, max: number): string {
  const value = min + rand() * (max - min);
  const fixed = value.toFixed(2);
  const [whole, cents] = fixed.split(".");
  return `${Number(whole).toLocaleString("en-US")}.${cents}`;
}

function isoDate(rand: Rand, year: number): string {
  const month = int(rand, 1, 12);
  const day = int(rand, 1, 28);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function addDays(rand: Rand, iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days + int(rand, 0, 5));
  return date.toISOString().slice(0, 10);
}

const VENDORS = [
  "Northwind Traders",
  "Cascade Precision Ltd",
  "Meridian Industrial Supply",
  "Blue Harbor Logistics",
  "Aurora Components GmbH",
  "Pinebrook Electrical Co",
] as const;

const BUYERS = [
  "Halcyon Fabrication",
  "Riverbend Manufacturing",
  "Kestrel Systems",
  "Tidewater Assembly",
] as const;

const CURRENCIES = ["USD", "EUR", "GBP"] as const;

const PAYMENT_TERMS = ["Net 30", "Net 45", "Net 60", "2/10 Net 30"] as const;

interface Rendered {
  readonly document: string;
  readonly fields: Readonly<Record<string, string>>;
}

function renderInvoice(rand: Rand): Rendered {
  const vendor = pick(rand, VENDORS);
  const buyer = pick(rand, BUYERS);
  const invoiceNumber = `INV-${int(rand, 2024, 2026)}-${String(int(rand, 1, 9999)).padStart(4, "0")}`;
  const poNumber = `PO-${int(rand, 10000, 99999)}`;
  const issueDate = isoDate(rand, 2026);
  const dueDate = addDays(rand, issueDate, 30);
  const currency = pick(rand, CURRENCIES);
  const subtotal = amount(rand, 800, 24000);
  const taxRate = pick(rand, ["0.05", "0.07", "0.08", "0.20"]);
  const subtotalValue = Number(subtotal.replace(/,/g, ""));
  const tax = amount(
    rand,
    subtotalValue * Number(taxRate) * 0.99,
    subtotalValue * Number(taxRate) * 1.01,
  );
  const total = amount(rand, subtotalValue, subtotalValue * 1.25);
  const terms = pick(rand, PAYMENT_TERMS);
  const previousInvoice = `INV-${int(rand, 2024, 2025)}-${String(int(rand, 1, 9999)).padStart(4, "0")}`;

  const document = [
    `${vendor}`,
    `1200 Commerce Way, Suite ${int(rand, 100, 990)}`,
    ``,
    `INVOICE`,
    `Invoice number: ${invoiceNumber}`,
    `Invoice date: ${issueDate}`,
    `Due date: ${dueDate}`,
    `Payment terms: ${terms}`,
    ``,
    `Bill to: ${buyer}`,
    `Purchase order: ${poNumber}`,
    ``,
    `Description                          Qty    Unit price      Amount`,
    `Machined bracket, type ${pick(rand, ["A", "B", "C"])}          ${int(rand, 4, 40)}     ${amount(rand, 40, 400)}      ${amount(rand, 400, 4000)}`,
    `Assembly jig, rev ${int(rand, 1, 9)}                  ${int(rand, 1, 8)}     ${amount(rand, 200, 900)}     ${amount(rand, 600, 5000)}`,
    ``,
    `Subtotal: ${currency} ${subtotal}`,
    `Tax: ${currency} ${tax}`,
    `Total due: ${currency} ${total}`,
    ``,
    `Notes: supersedes ${previousInvoice}, which was voided.`,
    `Remit to account ending ${int(rand, 1000, 9999)}.`,
  ].join("\n");

  return {
    document,
    fields: {
      invoice_number: invoiceNumber,
      vendor_name: vendor,
      buyer_name: buyer,
      issue_date: issueDate,
      due_date: dueDate,
      purchase_order: poNumber,
      currency,
      subtotal,
      tax,
      total_due: total,
      payment_terms: terms,
    },
  };
}

function renderPurchaseOrder(rand: Rand): Rendered {
  const vendor = pick(rand, VENDORS);
  const buyer = pick(rand, BUYERS);
  const orderNumber = `PO-${int(rand, 100000, 999999)}`;
  const requisition = `REQ-${int(rand, 1000, 9999)}`;
  const orderDate = isoDate(rand, 2026);
  const requiredDate = addDays(rand, orderDate, 21);
  const shipVia = pick(rand, ["DHL Express", "FedEx Ground", "UPS Freight", "Will Call"] as const);
  const department = pick(rand, ["Fabrication", "Maintenance", "Electrical", "Tooling"] as const);
  const currency = pick(rand, CURRENCIES);
  const quantity = int(rand, 10, 500);
  const unitPrice = amount(rand, 3, 90);
  const orderTotal = amount(
    rand,
    Number(unitPrice.replace(/,/g, "")) * quantity,
    Number(unitPrice.replace(/,/g, "")) * quantity * 1.1,
  );

  const document = [
    `${buyer} — PURCHASE ORDER`,
    ``,
    `Order number ${orderNumber}     Requisition ${requisition}`,
    `Order date ${orderDate}         Required by ${requiredDate}`,
    `Ship via ${shipVia}             Department ${department}`,
    ``,
    `Supplier: ${vendor}`,
    ``,
    `Item                                     Quantity   Unit price   Currency`,
    `${pick(rand, ["Hex bolt M8", "Steel plate 3mm", "Cable harness", "Bearing housing"])}                    ${quantity}        ${unitPrice}        ${currency}`,
    ``,
    `Order total ${currency} ${orderTotal}`,
    ``,
    `This order is issued against framework agreement ${pick(rand, ["FA-2025-07", "FA-2025-11", "FA-2026-02"])}.`,
    `Approved by ${pick(rand, ["R. Okafor", "L. Petrov", "S. Nakamura"])}.`,
  ].join("\n");

  return {
    document,
    fields: {
      order_number: orderNumber,
      requisition_number: requisition,
      supplier_name: vendor,
      order_date: orderDate,
      required_by: requiredDate,
      ship_via: shipVia,
      department,
      currency,
      unit_price: unitPrice,
      order_total: orderTotal,
    },
  };
}

function renderLabReport(rand: Rand): Rendered {
  const lab = pick(rand, [
    "Cascade Analytical",
    "Ridgeline Materials Lab",
    "Meridian Test Services",
  ] as const);
  const reportId = `LAB-${int(rand, 2024, 2026)}-${int(rand, 1000, 9999)}`;
  const sampleId = `S-${int(rand, 10000, 99999)}`;
  const collected = isoDate(rand, 2026);
  const received = addDays(rand, collected, 1);
  const reported = addDays(rand, received, 4);
  const material = pick(rand, [
    "Aluminium 6061-T6",
    "Carbon steel 1045",
    "Titanium grade 2",
    "Nylon 6/6",
  ] as const);
  const method = pick(rand, ["ASTM E8", "ISO 6892-1", "ASTM D638"] as const);
  const tensile = amount(rand, 210, 640);
  const elongation = amount(rand, 2, 24);
  const technician = pick(rand, ["A. Duarte", "M. Fischer", "K. Osei"] as const);
  const result = pick(rand, ["PASS", "FAIL"] as const);

  const document = [
    `${lab}`,
    `Materials test report`,
    ``,
    `Report ID: ${reportId}`,
    `Sample ID: ${sampleId}`,
    `Client reference: ${int(rand, 10000, 99999)}`,
    ``,
    `Material: ${material}`,
    `Test method: ${method}`,
    `Date collected: ${collected}`,
    `Date received: ${received}`,
    `Date reported: ${reported}`,
    ``,
    `Results`,
    `  Tensile strength: ${tensile} MPa`,
    `  Elongation at break: ${elongation} %`,
    `  Specimen count: ${int(rand, 3, 8)}`,
    ``,
    `Technician: ${technician}`,
    `Specification limit: ${amount(rand, 180, 260)} MPa minimum.`,
    `Overall result: ${result}`,
    ``,
    `Prior report ${reportId.replace(/LAB/, "LAB")}-R1 is superseded by this issue.`,
  ].join("\n");

  return {
    document,
    fields: {
      report_id: reportId,
      sample_id: sampleId,
      laboratory: lab,
      material,
      test_method: method,
      date_collected: collected,
      date_reported: reported,
      tensile_strength_mpa: tensile,
      elongation_percent: elongation,
      technician,
      overall_result: result,
    },
  };
}

function renderLeaseSummary(rand: Rand): Rendered {
  const landlord = pick(rand, [
    "Pinebrook Holdings",
    "Harborview Estates",
    "Cedar Lane Partners",
  ] as const);
  const tenant = pick(rand, ["Brightline Studio", "Cobalt Analytics", "Verdant Foods"] as const);
  const leaseId = `LSE-${int(rand, 1000, 9999)}`;
  const start = isoDate(rand, 2026);
  const end = `${Number(start.slice(0, 4)) + int(rand, 1, 5)}-${start.slice(5)}`;
  const rent = amount(rand, 1200, 9500);
  const deposit = amount(rand, 1200, 19000);
  const suite = `Suite ${int(rand, 100, 950)}`;
  const address = `${int(rand, 10, 990)} ${pick(rand, ["Market St", "Fremont Ave", "Bay Rd", "Union Sq"])}`;
  const currency = pick(rand, CURRENCIES);
  const escalation = pick(rand, ["3%", "4%", "2.5%"] as const);

  const document = [
    `LEASE SUMMARY`,
    ``,
    `Lease ID: ${leaseId}`,
    `Landlord: ${landlord}`,
    `Tenant: ${tenant}`,
    ``,
    `Premises: ${suite}, ${address}`,
    `Lease start: ${start}`,
    `Lease end: ${end}`,
    `Monthly rent: ${currency} ${rent}`,
    `Security deposit: ${currency} ${deposit}`,
    `Annual escalation: ${escalation}`,
    `Currency: ${currency}`,
    ``,
    `Broker: ${pick(rand, ["Lang Realty", "Summit Commercial", "Kestrel Property"])}`,
    `Notes: the previous lease ${leaseId.replace(/\d{4}$/, String(int(rand, 1000, 9999)))} covered only part of the premises.`,
  ].join("\n");

  return {
    document,
    fields: {
      lease_id: leaseId,
      landlord_name: landlord,
      tenant_name: tenant,
      premises_suite: suite,
      premises_address: address,
      lease_start: start,
      lease_end: end,
      monthly_rent: rent,
      security_deposit: deposit,
      currency,
      annual_escalation: escalation,
    },
  };
}

function renderSupportTicket(rand: Rand): Rendered {
  const ticketId = `TCK-${int(rand, 100000, 999999)}`;
  const account = pick(rand, ["ACME-42", "NORTH-77", "ORBIT-19", "SUMMIT-08"] as const);
  const opened = isoDate(rand, 2026);
  const priority = pick(rand, ["P1", "P2", "P3", "P4"] as const);
  const channel = pick(rand, ["email", "chat", "phone", "portal"] as const);
  const product = pick(rand, ["Gateway", "Sandbox Runner", "Cost Explorer", "Auth Proxy"] as const);
  const version = `${int(rand, 1, 4)}.${int(rand, 0, 12)}.${int(rand, 0, 9)}`;
  const assignee = pick(rand, ["dana.k", "ivan.p", "mei.l", "sam.r"] as const);
  const status = pick(rand, ["open", "triaged", "waiting-customer"] as const);
  const minutes = int(rand, 4, 900);

  const document = [
    `SUPPORT TICKET ${ticketId}`,
    ``,
    `Account: ${account}`,
    `Opened: ${opened} (${channel})`,
    `Priority: ${priority}`,
    `Product: ${product}`,
    `Reported version: ${version}`,
    `Assigned to: ${assignee}`,
    `Status: ${status}`,
    ``,
    `Summary: ${pick(rand, ["timeouts during batch runs", "unexpected 402 responses", "missing usage rows", "slow page loads"])}`,
    ``,
    `Reproduction:`,
    `1. Open ${pick(rand, ["Cost Explorer", "run history", "settings"])}.`,
    `2. Filter by account ${account}.`,
    `3. Observe failure after ${int(rand, 1, 30)} minutes.`,
    ``,
    `Time to first response: ${minutes} minutes`,
    `Related ticket ${ticketId.replace(/\d{6}$/, String(int(rand, 100000, 999999)))} was closed as duplicate.`,
  ].join("\n");

  return {
    document,
    fields: {
      ticket_id: ticketId,
      account,
      opened_at: opened,
      priority,
      channel,
      product,
      reported_version: version,
      assignee,
      status,
      time_to_first_response_minutes: String(minutes),
    },
  };
}

const TEMPLATES: readonly { readonly name: string; readonly render: (rand: Rand) => Rendered }[] = [
  { name: "invoice", render: renderInvoice },
  { name: "purchase_order", render: renderPurchaseOrder },
  { name: "lab_report", render: renderLabReport },
  { name: "lease_summary", render: renderLeaseSummary },
  { name: "support_ticket", render: renderSupportTicket },
];

/**
 * Generate the full synthetic seed: 5 document templates × 30 variants, ids
 * assigned in template order. Keys are listed in the order the fields are
 * rendered, so the prompt's key list reads like a form.
 */
export function generateSyntheticInstances(): SyntheticInstance[] {
  const instances: SyntheticInstance[] = [];
  let index = 0;
  for (const template of TEMPLATES) {
    for (let variant = 0; variant < SYNTHETIC_PER_TEMPLATE; variant++) {
      index += 1;
      const rand = mulberry32(SYNTHETIC_SEED + index * 7919);
      const rendered = template.render(rand);
      instances.push({
        id: `synthetic-ext-${String(index).padStart(3, "0")}`,
        template: template.name,
        initial_state: {
          document: rendered.document,
          keys: Object.keys(rendered.fields),
        },
        expected_outcome: { fields: rendered.fields },
      });
    }
  }
  return instances;
}
