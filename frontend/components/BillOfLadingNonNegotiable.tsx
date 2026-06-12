'use client';

import React from 'react';

type LoadLike = Partial<{
  loadId: string;
  referenceNumber: string;

  pickupAddress: string;
  pickupCity: string;
  pickupState: string;
  pickupZip: string;

  deliveryAddress: string;
  deliveryCity: string;
  deliveryState: string;
  deliveryZip: string;

  totalWeightLbs: number;
  totalMiles: number;

  rateAmount: number; // if you want to show somewhere later
  rateType: string;
  paymentTerms: string;
}>;

type Props = {
  load?: LoadLike;
  startCollapsed?: boolean;
};

function v(x?: string | number | null) {
  if (x === 0) return '0';
  if (x === undefined || x === null) return '—';
  const s = String(x).trim();
  return s.length ? s : '—';
}

function cityStateZip(city?: string, state?: string, zip?: string) {
  const c = (city || '').trim();
  const s = (state || '').trim();
  const z = (zip || '').trim();
  const left = [c, s].filter(Boolean).join(', ');
  const out = [left, z].filter(Boolean).join(' ');
  return out.trim() || '—';
}

function checkbox(label: string, checked: boolean) {
  return (
    <div className="flex items-center gap-2">
      <div className={`h-4 w-4 rounded-sm border ${checked ? 'bg-gray-900' : 'bg-white'}`} />
      <span className="text-xs font-semibold text-gray-700">{label}</span>
    </div>
  );
}

export default function BillOfLadingNonNegotiable({ load, startCollapsed = true }: Props) {
  const [collapsed, setCollapsed] = React.useState(startCollapsed);

  const bolNo = (load?.referenceNumber || load?.loadId || '').trim();
  const shipperCityStateZip = cityStateZip(load?.pickupCity, load?.pickupState, load?.pickupZip);
  const shipToCityStateZip = cityStateZip(load?.deliveryCity, load?.deliveryState, load?.deliveryZip);

  // Best-effort mapping; defaults to PREPAID if unknown
  const pt = (load?.paymentTerms || '').toUpperCase();
  const termPrepaid = !pt || pt.includes('PRE') || pt.includes('NET');
  const termCollect = pt.includes('COLLECT');
  const termThird = pt.includes('THIRD');

  return (
    <div className="rounded-2xl border bg-white shadow-sm">
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <div className="text-sm font-semibold tracking-wide text-gray-900">
            BILL OF LADING – NON-NEGOTIABLE
          </div>
          <div className="text-xs text-gray-500">
            Template layout integrated (values auto-fill where available; blanks remain as lines).
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-gray-50"
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      </div>

      {!collapsed && (
        <div className="px-5 pb-5">
          {/* TOP GRID */}
          <div className="grid grid-cols-12 gap-3">
            {/* LEFT BLOCK */}
            <div className="col-span-12 lg:col-span-8 space-y-3">
              {/* SHIPPER */}
              <div className="border rounded-xl overflow-hidden">
                <div className="grid grid-cols-12">
                  <div className="col-span-12 bg-gray-900 text-white px-4 py-2 text-xs font-bold tracking-wide">
                    SHIPPER
                  </div>

                  <div className="col-span-12 grid grid-cols-12">
                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">NAME</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>

                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">ADDRESS</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{v(load?.pickupAddress)}</div>

                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">CITY / STATE / ZIP</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{shipperCityStateZip}</div>

                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">SID NO.</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{v(load?.referenceNumber)}</div>
                  </div>
                </div>
              </div>

              {/* SHIP TO + CARRIER INFO ROW */}
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-12 lg:col-span-8 border rounded-xl overflow-hidden">
                  <div className="bg-gray-900 text-white px-4 py-2 text-xs font-bold tracking-wide">SHIP TO</div>

                  <div className="grid grid-cols-12">
                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">NAME</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>

                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">ADDRESS</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{v(load?.deliveryAddress)}</div>

                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">CITY / STATE / ZIP</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{shipToCityStateZip}</div>

                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">CID NO.</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-4 border rounded-xl overflow-hidden">
                  <div className="grid grid-cols-12">
                    <div className="col-span-12 bg-gray-900 text-white px-4 py-2 text-xs font-bold tracking-wide">
                      CARRIER INFO
                    </div>

                    <div className="col-span-5 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">CARRIER NAME</div>
                    <div className="col-span-7 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>

                    <div className="col-span-5 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">TRAILER NO.</div>
                    <div className="col-span-7 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>

                    <div className="col-span-5 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">SERIAL NOS.</div>
                    <div className="col-span-7 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>
                  </div>
                </div>
              </div>

              {/* THIRD PARTY BILL TO + SCAC/PRO */}
              <div className="grid grid-cols-12 gap-3">
                <div className="col-span-12 lg:col-span-8 border rounded-xl overflow-hidden">
                  <div className="bg-gray-900 text-white px-4 py-2 text-xs font-bold tracking-wide">
                    THIRD PARTY FREIGHT CHARGES BILL TO
                  </div>

                  <div className="grid grid-cols-12">
                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">NAME</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>

                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">ADDRESS</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>

                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">CITY / STATE / ZIP</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>

                    <div className="col-span-4 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">TELEPHONE</div>
                    <div className="col-span-8 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>
                  </div>
                </div>

                <div className="col-span-12 lg:col-span-4 border rounded-xl overflow-hidden">
                  <div className="grid grid-cols-12">
                    <div className="col-span-12 bg-gray-900 text-white px-4 py-2 text-xs font-bold tracking-wide">
                      IDENTIFIERS
                    </div>

                    <div className="col-span-5 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">SCAC</div>
                    <div className="col-span-7 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>

                    <div className="col-span-5 border-t px-3 py-2 text-[11px] font-semibold text-gray-600">PRO NO.</div>
                    <div className="col-span-7 border-t px-3 py-2 text-[11px] text-gray-900">{'—'}</div>
                  </div>
                </div>
              </div>

              {/* SPECIAL INSTRUCTIONS */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-gray-900 text-white px-4 py-2 text-xs font-bold tracking-wide">
                  SPECIAL INSTRUCTIONS
                </div>
                <div className="px-3 py-4 text-[11px] text-gray-900 min-h-[56px]">{'—'}</div>
              </div>
            </div>

            {/* RIGHT BLOCK */}
            <div className="col-span-12 lg:col-span-4 space-y-3">
              {/* BOL NO */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-gray-900 text-white px-4 py-2 text-xs font-bold tracking-wide">B of L NO.</div>
                <div className="px-3 py-3 text-sm font-semibold text-gray-900">{v(bolNo || '—')}</div>
              </div>

              {/* FREIGHT CHARGE TERMS */}
              <div className="border rounded-xl overflow-hidden">
                <div className="bg-gray-900 text-white px-4 py-2 text-xs font-bold tracking-wide">
                  FREIGHT CHARGE TERMS
                </div>
                <div className="px-3 py-3">
                  <div className="text-[11px] text-gray-700">
                    Freight charges prepaid unless marked otherwise.
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    {checkbox('PREPAID', termPrepaid)}
                    {checkbox('COLLECT', termCollect)}
                    {checkbox('THIRD PARTY', termThird)}
                  </div>
                  <div className="mt-3 text-[10px] text-gray-500">
                    Master bill of lading with attached underlying bills of lading.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* CUSTOMER ORDER TABLE */}
          <div className="mt-4 border rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 bg-gray-900 text-white text-xs font-bold tracking-wide">
              <div className="col-span-5 px-3 py-2">CUSTOMER ORDER NO.</div>
              <div className="col-span-2 px-3 py-2">NO. OF PKGS</div>
              <div className="col-span-1 px-3 py-2">WGT</div>
              <div className="col-span-1 px-3 py-2">PALLET / SLIP</div>
              <div className="col-span-3 px-3 py-2">ADDITIONAL SHIPPER INFO</div>
            </div>

            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="grid grid-cols-12 border-t text-[11px]">
                <div className="col-span-5 px-3 py-2">{i === 0 ? v(load?.referenceNumber) : ''}</div>
                <div className="col-span-2 px-3 py-2"></div>
                <div className="col-span-1 px-3 py-2">{i === 0 ? v(load?.totalWeightLbs ? `${load?.totalWeightLbs} lbs` : '') : ''}</div>
                <div className="col-span-1 px-3 py-2 flex gap-3">
                  <span>Y</span>
                  <span>N</span>
                </div>
                <div className="col-span-3 px-3 py-2"></div>
              </div>
            ))}
          </div>

          {/* HANDLING / DESCRIPTION TABLE */}
          <div className="mt-4 border rounded-xl overflow-hidden">
            <div className="bg-gray-900 text-white text-xs font-bold tracking-wide px-3 py-2">TOTAL</div>

            <div className="grid grid-cols-12 border-t bg-gray-50 text-[11px] font-semibold text-gray-700">
              <div className="col-span-2 px-3 py-2">HANDLING UNIT (QTY / TYPE)</div>
              <div className="col-span-2 px-3 py-2">PACKAGE (QTY / TYPE)</div>
              <div className="col-span-1 px-3 py-2">WGT</div>
              <div className="col-span-1 px-3 py-2">HM (X)</div>
              <div className="col-span-4 px-3 py-2">DESCRIPTION OF ARTICLES, SPECIAL MARKS &amp; EXCEPTIONS</div>
              <div className="col-span-1 px-3 py-2">NMFC NO.</div>
              <div className="col-span-1 px-3 py-2">CLASS</div>
            </div>

            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="grid grid-cols-12 border-t text-[11px] min-h-[34px]">
                <div className="col-span-2 px-3 py-2"></div>
                <div className="col-span-2 px-3 py-2"></div>
                <div className="col-span-1 px-3 py-2">{i === 0 ? v(load?.totalWeightLbs ? `${load?.totalWeightLbs}` : '') : ''}</div>
                <div className="col-span-1 px-3 py-2"></div>
                <div className="col-span-4 px-3 py-2"></div>
                <div className="col-span-1 px-3 py-2"></div>
                <div className="col-span-1 px-3 py-2"></div>
              </div>
            ))}
          </div>

          {/* DECLARED VALUE + COD / FEE TERMS */}
          <div className="mt-4 grid grid-cols-12 gap-3">
            <div className="col-span-12 lg:col-span-8 border rounded-xl p-3 text-[11px] text-gray-700">
              Where the rate is dependent on value, shippers are required to state specifically in writing
              the agreed or declared value of the property as follows: “The agreed or declared value
              of the property is specifically stated by the shipper to be not exceeding _________ per _________.”
            </div>

            <div className="col-span-12 lg:col-span-4 border rounded-xl overflow-hidden">
              <div className="bg-gray-900 text-white px-3 py-2 text-xs font-bold tracking-wide">COD AMOUNT $</div>
              <div className="px-3 py-3 text-[11px] text-gray-900">—</div>

              <div className="bg-gray-900 text-white px-3 py-2 text-xs font-bold tracking-wide">FEE TERMS</div>
              <div className="px-3 py-3 flex items-center justify-between">
                {checkbox('COLLECT', false)}
                {checkbox('PREPAID', true)}
                {checkbox('CUSTOMER CHECK', false)}
              </div>
            </div>
          </div>

          {/* NOTE LINE */}
          <div className="mt-4 text-[11px] text-gray-700 font-semibold">
            NOTE: Liability limitation for loss or damage in this shipment may be applicable. See 49 USC § 14706(c)(1)(A) and (B).
          </div>

          {/* TERMS + SIGNATURE */}
          <div className="mt-3 grid grid-cols-12 gap-3">
            <div className="col-span-12 lg:col-span-8 border rounded-xl p-3 text-[11px] text-gray-700">
              Received, subject to individually determined rates or contracts that have been agreed upon in writing between
              the carrier and shipper, if applicable, otherwise to the rates, classifications, and rules that have been established
              by the carrier and are available to the shipper, on request, and to all applicable state and federal regulations.
            </div>
            <div className="col-span-12 lg:col-span-4 border rounded-xl overflow-hidden">
              <div className="p-3 text-[11px] text-gray-700">
                The carrier shall not make delivery of this shipment without payment of charges and all other lawful fees.
              </div>
              <div className="bg-gray-900 text-white px-3 py-2 text-xs font-bold tracking-wide">SHIPPER SIGNATURE</div>
              <div className="px-3 py-4 text-[11px] text-gray-900">—</div>
            </div>
          </div>

          {/* SIGNATURES + TRAILER LOADED / FREIGHT COUNTED */}
          <div className="mt-4 border rounded-xl overflow-hidden">
            <div className="grid grid-cols-12 bg-gray-900 text-white text-xs font-bold tracking-wide">
              <div className="col-span-5 px-3 py-2">SHIPPER SIGNATURE &amp; DATE</div>
              <div className="col-span-5 px-3 py-2">CARRIER SIGNATURE &amp; PICK-UP DATE</div>
              <div className="col-span-2 px-3 py-2">TRAILER LOADED / FREIGHT COUNTED</div>
            </div>

            <div className="grid grid-cols-12 border-t">
              <div className="col-span-5 p-3 text-[11px] text-gray-700 min-h-[64px]">—</div>
              <div className="col-span-5 p-3 text-[11px] text-gray-700 min-h-[64px]">—</div>

              <div className="col-span-2 border-l">
                <div className="grid grid-cols-1">
                  <div className="bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-700 border-b">TRAILER LOADED</div>
                  <div className="px-3 py-2 text-[11px] text-gray-700 border-b">BY SHIPPER</div>
                  <div className="px-3 py-2 text-[11px] text-gray-700 border-b">BY DRIVER</div>

                  <div className="bg-gray-50 px-3 py-2 text-[11px] font-semibold text-gray-700 border-b">FREIGHT COUNTED</div>
                  <div className="px-3 py-2 text-[11px] text-gray-700 border-b">BY SHIPPER</div>
                  <div className="px-3 py-2 text-[11px] text-gray-700 border-b">BY DRIVER / PALLETS SAID TO CONTAIN</div>
                  <div className="px-3 py-2 text-[11px] text-gray-700">BY DRIVER PIECES</div>
                </div>
              </div>
            </div>
          </div>

          {/* BOTTOM DISCLAIMERS */}
          <div className="mt-4 grid grid-cols-12 gap-3 text-[11px] text-gray-700">
            <div className="col-span-12 lg:col-span-6 border rounded-xl p-3">
              This is to certify that the above named materials are properly classified, packaged, marked, and labeled,
              and are in proper condition for transportation according to the applicable regulations of the DOT.
            </div>
            <div className="col-span-12 lg:col-span-6 border rounded-xl p-3">
              Carrier acknowledges receipt of packages and required placards. Carrier certifies emergency response information
              was made available and/or carrier has the DOT emergency response guidebook or equivalent documentation in the vehicle.
              Property described above is received in good order, except as noted.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
