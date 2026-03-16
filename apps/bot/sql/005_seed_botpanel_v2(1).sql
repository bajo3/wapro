-- Seed: Bot Panel v2 (policies, FAQs, playbooks, AB variants, examples, and test cases)
-- Idempotent inserts (by title/name where possible)

-- =====================
-- POLICIES
-- =====================
insert into bot_policies (title, triggers, body, enabled, draft)
select
  'Toma de usados (reglas)' as title,
  array['usado','permuta','parte de pago','entrego','entregar','tomo mi auto']::text[] as triggers,
  $$
Reglas para tomar usados:
- Referencia general: se toman usados preferentemente hasta 150.000 km (depende estado/mantenimiento y modelo).
- Si supera 150.000 km: informar que es difícil tomarlo y pedir detalles/fotos para evaluar caso a caso.
- Si tiene GNC: pedir si está asentado en cédula, fecha de oblea, y estado del equipo.
- Pedir siempre: año, km, modelo/versión, fotos, y si tiene detalles.
- Si el cliente quiere una tasación: derivar a asesor humano con los datos.
$$ as body,
  true as enabled,
  false as draft
where not exists (select 1 from bot_policies where title='Toma de usados (reglas)');

insert into bot_policies (title, triggers, body, enabled, draft)
select
  'Financiación (reglas)' as title,
  array['financiacion','financiar','cuotas','anticipo','dni','prestamo']::text[] as triggers,
  $$
Reglas para financiación:
- Se puede financiar hasta ~40% con DNI (según el caso). Confirmar siempre condiciones vigentes.
- Antes de cotizar: pedir monto de anticipo y cantidad de cuotas deseadas.
- Aclarar que la aprobación y tasa dependen de evaluación.
- Si pide "tasa exacta": derivar a asesor humano.
$$ as body,
  true,
  false
where not exists (select 1 from bot_policies where title='Financiación (reglas)');

insert into bot_policies (title, triggers, body, enabled, draft)
select
  'Stock y precios (reglas)' as title,
  array['precio','vale','valor','stock','disponible','tenes','hay']::text[] as triggers,
  $$
Reglas de stock/precio:
- Precio y stock deben salir del catálogo/DB. No inventar.
- Si no hay coincidencia clara: pedir marca/modelo/año o presupuesto.
- Ofrecer 2-3 opciones similares si hay.
- Si el usuario pregunta por un auto específico: devolver ficha resumida y CTA a WhatsApp.
$$ as body,
  true,
  false
where not exists (select 1 from bot_policies where title='Stock y precios (reglas)');

-- =====================
-- FAQs
-- =====================
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Horarios' as title,
  array['horario','horarios','abren','cierran','sabado','domingo']::text[] as triggers,
  $$
Horarios: Lun a Vie 9:00 a 18:00. Sáb 9:30 a 13:00.
Si querés, decime qué día te queda cómodo y te coordinamos una visita.
$$ as answer,
  true as enabled,
  false as draft
where not exists (select 1 from bot_faq where title='Horarios');

insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Ubicación' as title,
  array['ubicacion','dirección','direccion','donde queda','mapa','cómo llego']::text[] as triggers,
  $$
Estamos en Tandil.
Decime desde qué zona venís y te paso la ubicación exacta y la mejor referencia para llegar.
$$ as answer,
  true,
  false
where not exists (select 1 from bot_faq where title='Ubicación');

insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Requisitos financiación (básico)' as title,
  array['requisitos','papeles','documentacion','dni','recibo','garante']::text[] as triggers,
  $$
Para arrancar, con DNI ya podemos ver una pre-evaluación (según el caso).
Para cotizar mejor: decime el modelo que te interesa, anticipo y cuotas.
$$ as answer,
  true,
  false
where not exists (select 1 from bot_faq where title='Requisitos financiación (básico)');

-- =====================
-- PLAYBOOKS (flows)
-- =====================
insert into bot_playbooks (intent, triggers, template, enabled, draft, config)
select
  'usado' as intent,
  array['tengo un','entrego','permuta','parte de pago','mi auto es','tomo mi auto']::text[] as triggers,
  $$
Perfecto. Para evaluar tu usado necesito:
- Modelo y año
- Kilometraje
- Si tiene GNC (y oblea al día)
- Estado general / detalles
- Fotos (frente, laterales, interior)

Con esos datos te digo si lo podemos tomar y cómo seguimos.
$$ as template,
  true,
  false,
  jsonb_build_object(
    'required_fields', jsonb_build_array('tradein_model','tradein_year','tradein_km'),
    'autoAskMissing', true,
    'max_tradein_km', 150000
  )
where not exists (select 1 from bot_playbooks where intent='usado');

insert into bot_playbooks (intent, triggers, template, enabled, draft, config)
select
  'financiacion' as intent,
  array['financiacion','cuotas','anticipo','financiar','dni']::text[] as triggers,
  $$
Dale. Para armarte una propuesta rápida decime:
1) ¿Qué auto te interesa (o tu presupuesto)?
2) ¿Cuánto querés poner de anticipo?
3) ¿En cuántas cuotas te gustaría?

Con eso te paso una estimación y lo vemos con un asesor.
$$ as template,
  true,
  false,
  jsonb_build_object(
    'required_fields', jsonb_build_array('down_payment','installments'),
    'autoAskMissing', true
  )
where not exists (select 1 from bot_playbooks where intent='financiacion');

insert into bot_playbooks (intent, triggers, template, enabled, draft, config)
select
  'stock' as intent,
  array['tenes','hay','stock','disponible','busco','buscando']::text[] as triggers,
  $$
Bien. Para encontrarte opciones:
- ¿Qué marca/modelo buscás?
- ¿Año aproximado?
- ¿Tu presupuesto (contado o anticipo)?

Con eso te paso 2-3 opciones disponibles.
$$ as template,
  true,
  false,
  jsonb_build_object(
    'required_fields', jsonb_build_array('vehicle_query'),
    'autoAskMissing', true
  )
where not exists (select 1 from bot_playbooks where intent='stock');

insert into bot_playbooks (intent, triggers, template, enabled, draft, config)
select
  'ubicacion' as intent,
  array['ubicacion','direccion','donde queda','mapa','como llego','cómo llego']::text[] as triggers,
  $$
Estamos en Tandil.
¿Desde qué zona venís? Así te paso la ubicación exacta y una referencia para llegar.
$$ as template,
  true,
  false,
  jsonb_build_object(
    'required_fields', jsonb_build_array('from_zone'),
    'autoAskMissing', true
  )
where not exists (select 1 from bot_playbooks where intent='ubicacion');

-- =====================
-- A/B VARIANTS
-- =====================
insert into bot_ab_variants (scope, scope_key, variant, weight, template_override, enabled)
values
  ('intent','financiacion','short',0.5,
   $$
Para cotizar: auto o presupuesto + anticipo + cuotas.
Con esos 3 datos te lo armo.
$$, true),
  ('intent','financiacion','persuasive',0.5,
   $$
Genial. Con anticipo + cuotas te preparo una estimación.
¿Querés que lo enfoquemos a la cuota más baja posible o a entregar menos anticipo?
$$, true)
on conflict (scope, scope_key, variant) do nothing;

-- =====================
-- EXAMPLES (few-shot library)
-- =====================
insert into bot_examples (intent, user_text, ideal_answer, notes)
select
  'usado',
  'Tengo un Fox 2012 con GNC y 190 mil km',
  $$
Gracias. Por el kilometraje (190.000 km) suele ser difícil tomarlo en parte de pago.
Igual, si querés lo evaluamos: ¿me pasás fotos (frente/laterales/interior), estado general y si el GNC está asentado y con oblea al día?
Con eso te digo si podemos considerarlo.
$$,
  'Aplicar regla 150k + pedir datos mínimos.'
where not exists (
  select 1 from bot_examples where intent='usado' and user_text='Tengo un Fox 2012 con GNC y 190 mil km'
);

insert into bot_examples (intent, user_text, ideal_answer, notes)
select
  'financiacion',
  'Puedo financiar sin recibo?',
  $$
Podemos ver opciones con DNI (según el caso). Para orientarte mejor: ¿qué auto te interesa o qué presupuesto manejás, cuánto podrías poner de anticipo y en cuántas cuotas?
$$,
  'Pedir datos antes de cotizar.'
where not exists (
  select 1 from bot_examples where intent='financiacion' and user_text='Puedo financiar sin recibo?'
);

-- =====================
-- TEST SUITE (24 casos)
-- =====================
-- Nota: expected_source_type admite: policy | faq | playbook | rag

-- USADO (6)
insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'usado_01_km_alto_gnc',
  'Tengo un Fox 2012 con GNC 190 mil km',
  'usado',
  'policy',
  array['190','difícil','fotos'],
  array['precio exacto'],
  array['tradein_year','tradein_km'],
  true
where not exists (select 1 from bot_test_cases where name='usado_01_km_alto_gnc');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'usado_02_permuta_basico',
  '¿Tomás mi usado en parte de pago?',
  'usado',
  'playbook',
  array['modelo','año','kilomet'],
  array['transferencia ya'],
  array['tradein_model','tradein_year','tradein_km'],
  true
where not exists (select 1 from bot_test_cases where name='usado_02_permuta_basico');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'usado_03_km_bajo',
  'Tengo un Gol 2017 98000 km',
  'usado',
  'playbook',
  array['evaluar','fotos'],
  array['no lo tomo'],
  array['tradein_year','tradein_km'],
  true
where not exists (select 1 from bot_test_cases where name='usado_03_km_bajo');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'usado_04_gnc_papeles',
  'Mi auto tiene GNC, sirve?',
  'usado',
  'policy',
  array['oblea','asentado'],
  array['garantizado'],
  array[]::text[],
  true
where not exists (select 1 from bot_test_cases where name='usado_04_gnc_papeles');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'usado_05_solo_km',
  'Mi auto tiene 160 mil km',
  'usado',
  'policy',
  array['160','modelo','año'],
  array['sí lo tomo seguro'],
  array['tradein_model','tradein_year','tradein_km'],
  true
where not exists (select 1 from bot_test_cases where name='usado_05_solo_km');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'usado_06_tasacion',
  '¿Cuánto me das por mi usado?',
  'usado',
  'policy',
  array['fotos','derivar'],
  array['te doy 5 millones'],
  array[]::text[],
  true
where not exists (select 1 from bot_test_cases where name='usado_06_tasacion');

-- FINANCIACIÓN (6)
insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'fin_01_sin_datos',
  'Quiero financiar',
  'financiacion',
  'playbook',
  array['anticipo','cuotas'],
  array['tasa 12%'],
  array['down_payment','installments'],
  true
where not exists (select 1 from bot_test_cases where name='fin_01_sin_datos');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'fin_02_pide_tasa',
  '¿Qué tasa tienen?',
  'financiacion',
  'policy',
  array['depende','asesor'],
  array['tasa exacta'],
  array[]::text[],
  true
where not exists (select 1 from bot_test_cases where name='fin_02_pide_tasa');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'fin_03_40_porciento',
  '¿Financian el 40% con DNI?',
  'financiacion',
  'policy',
  array['DNI','según el caso'],
  array['siempre'],
  array[]::text[],
  true
where not exists (select 1 from bot_test_cases where name='fin_03_40_porciento');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'fin_04_anticipo_cuotas',
  'Tengo 3 millones de anticipo y quiero 24 cuotas',
  'financiacion',
  'playbook',
  array['estimación','asesor'],
  array['aprobado'],
  array[]::text[],
  true
where not exists (select 1 from bot_test_cases where name='fin_04_anticipo_cuotas');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'fin_05_sin_recibo',
  'No tengo recibo, puedo financiar igual?',
  'financiacion',
  'faq',
  array['DNI','anticipo','cuotas'],
  array['garantizado'],
  array[]::text[],
  true
where not exists (select 1 from bot_test_cases where name='fin_05_sin_recibo');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'fin_06_pregunta_documentos',
  '¿Qué papeles necesito para financiar?',
  'financiacion',
  'faq',
  array['DNI','anticipo'],
  array['Cuil obligatorio'],
  array[]::text[],
  true
where not exists (select 1 from bot_test_cases where name='fin_06_pregunta_documentos');

-- STOCK (6)
insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'stock_01_busco_cronos',
  'Tenés Fiat Cronos?',
  'stock',
  'playbook',
  array['marca','modelo','año'],
  array['sí seguro'],
  array['vehicle_query'],
  true
where not exists (select 1 from bot_test_cases where name='stock_01_busco_cronos');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'stock_02_pide_precio_solo',
  'Cuánto vale el Onix?',
  'stock',
  'policy',
  array['catálogo','año'],
  array['13.800.000'],
  array[]::text[],
  true
where not exists (select 1 from bot_test_cases where name='stock_02_pide_precio_solo');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'stock_03_presupuesto',
  'Busco algo hasta 15 millones',
  'stock',
  'playbook',
  array['opciones','marca'],
  array['tengo este exacto'],
  array['vehicle_query'],
  true
where not exists (select 1 from bot_test_cases where name='stock_03_presupuesto');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'stock_04_disponible_hoy',
  'Hay stock hoy?',
  'stock',
  'policy',
  array['catálogo','pedir'],
  array['sí siempre'],
  array[]::text[],
  true
where not exists (select 1 from bot_test_cases where name='stock_04_disponible_hoy');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'stock_05_busco_2018',
  'Busco un auto 2018 manual',
  'stock',
  'playbook',
  array['presupuesto','marca'],
  array['tasa'],
  array['vehicle_query'],
  true
where not exists (select 1 from bot_test_cases where name='stock_05_busco_2018');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'stock_06_consulta_general',
  'Qué autos tenés?',
  'stock',
  'playbook',
  array['marca','modelo','presupuesto'],
  array['todos'],
  array['vehicle_query'],
  true
where not exists (select 1 from bot_test_cases where name='stock_06_consulta_general');

-- UBICACIÓN (6)
insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'ubi_01_donde_queda',
  'Dónde queda la agencia?',
  'ubicacion',
  'playbook',
  array['Tandil','zona'],
  array['calle'],
  array['from_zone'],
  true
where not exists (select 1 from bot_test_cases where name='ubi_01_donde_queda');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'ubi_02_direccion',
  'Pasame la dirección',
  'ubicacion',
  'playbook',
  array['zona','ubicación'],
  array['google.com/maps'],
  array['from_zone'],
  true
where not exists (select 1 from bot_test_cases where name='ubi_02_direccion');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'ubi_03_horarios',
  'Qué horario manejan?',
  null,
  'faq',
  array['Lun','Sáb'],
  array['24hs'],
  array[]::text[],
  true
where not exists (select 1 from bot_test_cases where name='ubi_03_horarios');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'ubi_04_como_llego',
  'Cómo llego desde el centro?',
  'ubicacion',
  'playbook',
  array['zona'],
  array['ruta exacta'],
  array['from_zone'],
  true
where not exists (select 1 from bot_test_cases where name='ubi_04_como_llego');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'ubi_05_mapa',
  'Tenés mapa?',
  'ubicacion',
  'faq',
  array['Tandil','zona'],
  array['link directo'],
  array[]::text[],
  true
where not exists (select 1 from bot_test_cases where name='ubi_05_mapa');

insert into bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
select
  'ubi_06_donde_estan',
  'En qué parte de Tandil están?',
  'ubicacion',
  'playbook',
  array['Tandil','zona'],
  array['calle'],
  array['from_zone'],
  true
where not exists (select 1 from bot_test_cases where name='ubi_06_donde_estan');

