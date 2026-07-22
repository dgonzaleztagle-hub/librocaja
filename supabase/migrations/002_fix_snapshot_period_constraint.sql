alter table libro_caja.rcv_snapshots
  drop constraint if exists rcv_snapshots_period_check;

alter table libro_caja.rcv_snapshots
  add constraint rcv_snapshots_period_check
  check (period ~ '^[0-9]{4}-[0-9]{2}$');
