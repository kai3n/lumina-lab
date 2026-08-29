-- Register supplier uploads as first-class order media instead of trusting
-- client-supplied COS object keys embedded only in supplier_updates.media.
alter table media_assets
  add column if not exists provider text
    check (provider in ('cos', 'r2', 'local')),
  add column if not exists owner_supplier_id bigint
    references suppliers(id) on delete set null,
  add column if not exists supplier_assignment_id bigint
    references supplier_order_assignments(id) on delete cascade,
  add column if not exists purpose text
    check (purpose in ('STONE', 'ESTIMATE', 'CAD', 'PROGRESS', 'QC', 'SHIPPING')),
  add column if not exists etag text,
  add column if not exists verified_at timestamptz;

create index if not exists media_assets_supplier_assignment_idx
  on media_assets (supplier_assignment_id, purpose, created_at desc)
  where owner_supplier_id is not null;
