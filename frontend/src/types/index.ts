export type RoleName = 'administrator' | 'techniker';

export interface User {
  id: number;
  username: string;
  name: string;
  role: RoleName;
  email?: string | null;
  must_change_password: boolean;
}

export interface UserRow extends User {
  active: boolean;
  last_login_at: string | null;
  created_at: string;
}

export interface ModuleDef {
  key: string;
  path: string;
  label: string;
  subtitle: string;
  icon: string;
}

export interface AuditEntry {
  id: number;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  created_at: string;
  username: string | null;
  name: string | null;
}

export type ItemKind = 'geraet' | 'artikel';

export interface Item {
  id: number;
  kind: ItemKind;
  name: string;
  manufacturer: string | null;
  model: string | null;
  article_number: string | null;
  category_id: number | null;
  category_name?: string | null;
  storage_location_id: number | null;
  location_name?: string | null;
  location_path?: string | null;
  case_id: number | null;
  case_name?: string | null;
  case_code?: string | null;
  case_location_path?: string | null;
  quantity: number;
  unit: string | null;
  min_stock: number | null;
  inventory_number: string | null;
  serial_number: string | null;
  status: DeviceStatus;
  condition: string | null;
  purchase_price: number | null;
  purchase_date: string | null;
  current_value: number | null;
  warranty: string | null;
  supplier_id: number | null;
  supplier_name?: string | null;
  current_event_id: number | null;
  event_name?: string | null;
  description: string | null;
  technical_data: string | null;
  manual_url: string | null;
  notes: string | null;
  qr_token: string | null;
  created_at: string;
  updated_at: string;
}

export type DeviceStatus =
  | 'verfuegbar'
  | 'ausgelagert'
  | 'defekt'
  | 'wartung'
  | 'verloren'
  | 'ausser_betrieb';

export interface Category {
  id: number;
  name: string;
  description: string | null;
  item_count: number;
}

export interface Supplier {
  id: number;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  customer_number: string | null;
  address: string | null;
  notes: string | null;
  item_count: number;
}

export interface StorageLocation {
  id: number;
  parent_id: number | null;
  type: 'lager' | 'regal' | 'fach';
  name: string;
  code: string | null;
  description: string | null;
  qr_token: string | null;
  item_count?: number;
  children?: StorageLocation[];
}

export interface EventRow {
  id: number;
  name: string;
  description: string | null;
  location: string | null;
  contact_name: string | null;
  starts_at: string | null;
  ends_at: string | null;
  status: EventStatus;
  notes: string | null;
  created_by: number | null;
  created_by_name: string | null;
  item_plan_count: number;
  device_plan_count: number;
  case_plan_count: number;
  open_checkouts: number;
  can_edit?: boolean;
}

export interface EventEditor {
  id: number;
  name: string;
  username: string;
  role: RoleName;
}

export interface UserOption {
  id: number;
  name: string;
  username: string;
}

export type EventStatus =
  | 'entwurf'
  | 'geplant'
  | 'vorbereitung'
  | 'aktiv'
  | 'abgeschlossen'
  | 'abgesagt';

export interface EventPlanItem {
  id: number;
  item_id: number;
  quantity: number;
  status: string;
  note: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
  stock: number;
  unit: string | null;
  inventory_number: string | null;
}

export interface EventPlanDevice {
  id: number;
  item_id: number;
  status: string;
  quantity: number;
  note: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
  inventory_number: string | null;
  serial_number: string | null;
  device_status: DeviceStatus;
  category_id: number | null;
  category_name: string | null;
}

export type CaseStatus = 'verfuegbar' | 'ausgelagert' | 'defekt' | 'ausser_betrieb';

export interface CaseRow {
  id: number;
  name: string;
  code: string | null;
  description: string | null;
  storage_location_id: number | null;
  status: CaseStatus;
  qr_token: string | null;
  location_path: string | null;
  item_count: number;
  created_at: string;
  updated_at: string;
}

export interface CaseItem {
  id: number;
  item_id: number;
  quantity: number;
  note: string | null;
  kind: ItemKind;
  name: string;
  manufacturer: string | null;
  model: string | null;
  inventory_number: string | null;
  unit: string | null;
  status: DeviceStatus;
  stock: number;
  category_name: string | null;
}

export interface CaseAssignment {
  case_id: number;
  quantity: number;
  note: string | null;
  case_name: string;
  case_code: string | null;
  case_status: CaseStatus;
  location_path: string | null;
  item_count: number;
}

export interface EventPlanCase {
  id: number;
  case_id: number;
  status: string;
  note: string | null;
  name: string;
  code: string | null;
  case_status: CaseStatus;
  location_path: string | null;
  item_count: number;
}

export interface Checkout {
  id: number;
  item_id: number;
  event_id: number | null;
  event_name: string | null;
  user_name: string | null;
  quantity: number;
  checked_out_at: string;
  due_at: string | null;
  returned_at: string | null;
  status: 'offen' | 'zurueck';
  condition_out: string | null;
  condition_in: string | null;
  note: string | null;
  name?: string;
  manufacturer?: string | null;
  model?: string | null;
  inventory_number?: string | null;
  serial_number?: string | null;
  kind?: ItemKind;
  unit?: string | null;
}

export interface ReturnRow {
  id: number;
  checkout_id: number | null;
  item_id: number;
  event_id: number | null;
  event_name: string | null;
  user_name: string | null;
  quantity: number;
  returned_at: string;
  condition: string | null;
  note: string | null;
  name: string;
  inventory_number: string | null;
  kind: ItemKind;
  unit: string | null;
}

export type MaintenanceStatus =
  | 'gemeldet'
  | 'pruefung'
  | 'reparatur'
  | 'ersatzteil'
  | 'repariert'
  | 'nicht_reparierbar';

export interface MaintenanceEntry {
  id: number;
  item_id: number;
  problem: string;
  description: string | null;
  reported_at: string;
  reported_by: number | null;
  reported_by_name: string | null;
  technician_id: number | null;
  technician_name: string | null;
  status: MaintenanceStatus;
  repair: string | null;
  cost: number | null;
  note: string | null;
  completed_at: string | null;
  name: string;
  manufacturer: string | null;
  model: string | null;
  inventory_number: string | null;
  serial_number: string | null;
  kind: ItemKind;
}

export interface MaintenanceLog {
  id: number;
  maintenance_id: number;
  user_id: number | null;
  user_name: string | null;
  status: string | null;
  note: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: number;
  title: string;
  doc_type: string;
  item_id: number | null;
  item_name: string | null;
  inventory_number: string | null;
  stored_name: string;
  original_name: string;
  mime_type: string | null;
  size_bytes: number | null;
  notes: string | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export type PurchaseStatus = 'geplant' | 'bestellt' | 'geliefert' | 'abgeschlossen' | 'storniert';

export interface Purchase {
  id: number;
  title: string;
  item_id: number | null;
  item_name: string | null;
  inventory_number: string | null;
  quantity: number;
  supplier_id: number | null;
  supplier_name: string | null;
  planned_price: number | null;
  actual_price: number | null;
  status: PurchaseStatus;
  ordered_at: string | null;
  delivered_at: string | null;
  notes: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface InventorySession {
  id: number;
  name: string;
  area_location_id: number | null;
  area_name: string | null;
  status: 'offen' | 'abgeschlossen';
  created_by: number | null;
  user_name: string | null;
  started_at: string;
  completed_at: string | null;
  notes: string | null;
  item_count: number;
  counted_count: number;
}

export interface InventoryCount {
  id: number;
  session_id: number;
  item_id: number;
  expected_quantity: number;
  counted_quantity: number | null;
  difference: number | null;
  counted_at: string | null;
  item_name: string;
  manufacturer: string | null;
  model: string | null;
  inventory_number: string | null;
  serial_number: string | null;
  kind: ItemKind;
  unit: string | null;
  location_path: string | null;
}

export interface StockMovement {
  id: number;
  item_id: number;
  type: string;
  quantity: number;
  before_quantity: number;
  after_quantity: number;
  condition: string | null;
  note: string | null;
  created_at: string;
  user_name: string | null;
  event_name: string | null;
}

export interface SearchResults {
  items: Array<{
    id: number;
    kind: ItemKind;
    name: string;
    manufacturer: string | null;
    model: string | null;
    inventory_number: string | null;
    serial_number: string | null;
    quantity: number;
    unit: string | null;
    status: DeviceStatus;
    location_path: string | null;
  }>;
  locations: Array<{ id: number; type: string; name: string; code: string | null; path: string }>;
  events: Array<{
    id: number;
    name: string;
    location: string | null;
    status: EventStatus;
    starts_at: string | null;
  }>;
  suppliers: Array<{ id: number; name: string; contact_name: string | null; email: string | null }>;
}

export interface LabelFormat {
  id: string;
  label: string;
  width: number;
  height: number;
}

export interface LabelRow {
  type: 'item' | 'location';
  id: number;
  name: string;
  inventory_number: string | null;
  category_name: string | null;
  code: string | null;
  location_path: string | null;
  qr_token: string;
  label_text: string;
  sub_text: string | null;
}

export interface LabelPreview {
  labels: LabelRow[];
  count: number;
  format: LabelFormat;
  qr_base_url: string;
}

export interface PlannedEventRef {
  event_id: number;
  plan_status: string;
  note: string | null;
  name: string;
  starts_at: string | null;
  ends_at: string | null;
  event_status: EventStatus;
}

export interface PlannedArtikelRef extends PlannedEventRef {
  quantity: number;
}

export interface AssetHistory {
  movements: Array<{
    id: number;
    type: string;
    quantity: number;
    before_quantity: number;
    after_quantity: number;
    condition: string | null;
    note: string | null;
    created_at: string;
    user_name: string | null;
    event_name: string | null;
  }>;
  checkouts: Checkout[];
  maintenance: MaintenanceEntry[];
  plannedEvents: PlannedEventRef[];
  plannedAsArtikel: PlannedArtikelRef[];
}

export interface ResolvedQr {
  type: 'item' | 'location' | 'case';
  id: number;
  kind?: string;
  name: string;
  path: string;
}

export interface PublicSettings {
  system_name: string;
  logo_url: string;
  support_email: string;
}
