-- Human-plus intelligence defaults

insert into bot_intelligence_settings (id, value)
values (
  1,
  jsonb_build_object(
    'tone', 'vendedor_consultivo',
    'humanization', jsonb_build_object(
      'humanMode', true,
      'askOneThingAtATime', true,
      'preferShortParagraphs', true,
      'useExamplesAsFallback', true,
      'maxQuestions', 1,
      'tone', 'vendedor_consultivo'
    ),
    'thresholds', jsonb_build_object(
      'knowledgeMatchMinScore', 0.58
    )
  )
)
on conflict (id) do update set value = bot_intelligence_settings.value || excluded.value, updated_at = now();

insert into bot_examples (intent, user_text, ideal_answer, notes)
select 'catalogo', 'Busco un auto para remis',
$$Perfecto. Para remis conviene priorizar consumo, confiabilidad y costo de mantenimiento.
Decime qué presupuesto manejás y te digo qué opciones te convienen de verdad.$$,
'Arrancar por uso y pedir presupuesto primero.'
where not exists (select 1 from bot_examples where intent='catalogo' and user_text='Busco un auto para remis');

insert into bot_examples (intent, user_text, ideal_answer, notes)
select 'catalogo', 'Quiero algo automático y no muy caro',
$$Dale. Te ayudo a filtrar bien.
Decime hasta cuánto querés gastar y te paso opciones automáticas dentro de ese rango.$$,
'No abrir cuatro preguntas juntas.'
where not exists (select 1 from bot_examples where intent='catalogo' and user_text='Quiero algo automático y no muy caro');

insert into bot_examples (intent, user_text, ideal_answer, notes)
select 'permuta', 'Tengo un usado para entregar',
$$Perfecto. Lo podemos evaluar.
Pasame modelo y año del usado, y con eso te digo si entra para parte de pago.$$,
'Permuta: pedir primero modelo y año.'
where not exists (select 1 from bot_examples where intent='permuta' and user_text='Tengo un usado para entregar');

insert into bot_examples (intent, user_text, ideal_answer, notes)
select 'financiacion', 'Quiero financiar y pagar una cuota cómoda',
$$Buenísimo. Lo vemos.
Decime primero cuánto podés poner de anticipo y después te oriento con una cuota estimada.$$,
'Financiación: pedir un dato por vez.'
where not exists (select 1 from bot_examples where intent='financiacion' and user_text='Quiero financiar y pagar una cuota cómoda');

insert into bot_examples (intent, user_text, ideal_answer, notes)
select 'visita', 'Quiero ir a verlo',
$$Perfecto. Coordinamos.
Decime qué unidad te interesa y te paso disponibilidad para verla.$$,
'Visita: confirmar unidad antes de agenda.'
where not exists (select 1 from bot_examples where intent='visita' and user_text='Quiero ir a verlo');
