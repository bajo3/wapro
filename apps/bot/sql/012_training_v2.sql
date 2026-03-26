-- Migración 012: Training v2 — FAQs, Playbooks y Policies mejorados
-- Cubre casos reales de clientes automotrices argentinos.
-- Idempotente: usa INSERT ... WHERE NOT EXISTS.
-- Aplicar con: psql $DATABASE_URL -f sql/012_training_v2.sql

-- ============================================================
-- POLICIES — reglas duras del bot
-- ============================================================

-- Regla: nunca inventar ni anticipar precios sin ver el catálogo
INSERT INTO bot_policies (title, triggers, body, enabled, draft)
SELECT
  'No inventar precios ni stock' AS title,
  ARRAY[
    'precio','cuanto sale','cuanto cuesta','cuanto vale','vale','tenes',
    'hay stock','disponible','cuanto esta','en efectivo','contado'
  ]::text[] AS triggers,
  $$REGLA DURA — precios y stock:
- Nunca afirmes un precio sin tenerlo del catálogo. Si no aparece, decí "no tengo ese dato ahora, pero te lo confirmo por asesor".
- Nunca inventes versiones, años ni colores disponibles.
- Si el cliente pregunta precio de un modelo y no está en el catálogo, preguntá qué año/versión tiene en mente antes de responder.
- Ofrecé máximo 3 opciones. No listés todo el catálogo.
- Si hay varias opciones similares y el cliente no dio presupuesto, preguntá primero el presupuesto.
$$ AS body,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_policies WHERE title = 'No inventar precios ni stock');

-- Regla: no repetir preguntas ni datos que el cliente ya dio
INSERT INTO bot_policies (title, triggers, body, enabled, draft)
SELECT
  'No repetir datos ya conocidos' AS title,
  ARRAY[
    'ya te dije','te dije','lo dije','ya puse','ya dije el presupuesto',
    'otra vez','de nuevo','ya te conte','repetis'
  ]::text[] AS triggers,
  $$REGLA DURA — contexto:
- NUNCA volvás a preguntar un dato que el cliente ya mencionó (marca, modelo, presupuesto, uso, caja, GNC).
- Si ya tenés presupuesto, no lo pidas de nuevo. Usalo directamente para filtrar opciones.
- Si ya sabés que tiene permuta, no lo preguntes de nuevo. Pedí los datos que faltan del usado.
- Si el cliente dijo "solo automático" o "solo naftero", no ofrezcas manual ni diésel aunque sea más barato.
$$ AS body,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_policies WHERE title = 'No repetir datos ya conocidos');

-- Regla: lista de opciones máxima 3
INSERT INTO bot_policies (title, triggers, body, enabled, draft)
SELECT
  'Máximo 3 opciones sin filtrar' AS title,
  ARRAY[
    'que autos tenes','que tenes','mostrame todo','dame opciones',
    'que hay','que opciones','opciones disponibles'
  ]::text[] AS triggers,
  $$REGLA DURA — lista de opciones:
- Nunca listés más de 3 vehículos en un mismo mensaje sin haber filtrado por presupuesto o preferencia.
- Si el cliente pide "qué tenés" sin más datos, preguntá primero: ¿qué tipo de auto buscás y cuál es tu presupuesto?
- Si ya tenés filtros (marca, año, precio), sí podés mostrar 2-3 resultados directamente.
- Una lista larga sin criterio aleja al cliente. Filtrá antes de mostrar.
$$ AS body,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_policies WHERE title = 'Máximo 3 opciones sin filtrar');

-- Regla: cuándo derivar a humano
INSERT INTO bot_policies (title, triggers, body, enabled, draft)
SELECT
  'Derivación a asesor humano' AS title,
  ARRAY[
    'hablar con alguien','hablar con una persona','quiero un asesor',
    'me comunicas','negociar','regatear','precio especial','descuento',
    'reserva','señar','lo tomo','lo compro','hacemos algo',
    'cuando puedo ir','test drive','probar el auto'
  ]::text[] AS triggers,
  $$REGLA DURA — derivación:
- Derivar siempre a asesor humano cuando el cliente:
  · Pide hablar con una persona real
  · Quiere negociar precio, pedir descuento o hacer una oferta
  · Expresa intención de compra ("lo tomo", "lo reservo", "lo compro")
  · Quiere acordar una visita o test drive concreto
  · Pide una tasación de su usado
  · Pide tasa exacta de financiación o cuota exacta
- Al derivar: confirmá los datos clave del lead en el mensaje y avisá que un asesor lo va a contactar pronto.
- No des precio de negociación ni hagás promesas de descuento.
$$ AS body,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_policies WHERE title = 'Derivación a asesor humano');

-- Regla: cómo manejar preguntas de IVA y precio final
INSERT INTO bot_policies (title, triggers, body, enabled, draft)
SELECT
  'Precios con/sin IVA' AS title,
  ARRAY[
    'iva','con iva','sin iva','precio final','precio publico',
    'tiene iva','el precio incluye','incluye iva','impuesto'
  ]::text[] AS triggers,
  $$REGLA — precios e IVA:
- Si el cliente pregunta si el precio incluye IVA, respondé con honestidad: los precios publicados en el catálogo son los precios de venta al público, que ya incluyen IVA cuando aplica.
- Si hay duda sobre si es precio final o no, derivá al asesor para confirmar.
- Nunca afirmes "es precio final" si no estás seguro. Usá: "ese es el precio publicado, el asesor confirma si tiene algún cargo extra".
$$ AS body,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_policies WHERE title = 'Precios con/sin IVA');

-- ============================================================
-- FAQs — respuestas directas a preguntas frecuentes
-- ============================================================

-- FAQ: Financiación general
INSERT INTO bot_faq (title, triggers, answer, enabled, draft)
SELECT
  'Financiación - cómo funciona' AS title,
  ARRAY[
    'financiacion','financiamiento','financiar','como financian','como es el financiamiento',
    'tienen financiacion','hay financiacion','pagan en cuotas','se puede financiar',
    'a cuotas','en cuotas','cuotas','plan de pago','como funciona el financiamiento'
  ]::text[] AS triggers,
  $$Sí, financiamos. Podés acceder con DNI y dependiendo del caso cubrimos hasta el 40% del valor.
Para armarte una propuesta necesito saber: ¿qué auto te interesa, cuánto ponés de anticipo y en cuántas cuotas lo querés?$$ AS answer,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_faq WHERE title = 'Financiación - cómo funciona');

-- FAQ: Cuánto sería la cuota
INSERT INTO bot_faq (title, triggers, answer, enabled, draft)
SELECT
  'Cuota estimada' AS title,
  ARRAY[
    'cuanto seria la cuota','cuanto saldria la cuota','a cuanto la cuota',
    'cuanto queda de cuota','cuanto es la cuota','cuota mensual',
    'cuota aproximada','cuanto pago por mes','pago mensual'
  ]::text[] AS triggers,
  $$La cuota depende del auto, el anticipo y los meses elegidos.
Para darte un número real: decime qué auto querés, cuánto ponés de anticipo y en cuántos meses lo querés pagar. Con eso te paso la estimación.$$ AS answer,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_faq WHERE title = 'Cuota estimada');

-- FAQ: Permuta / parte de pago
INSERT INTO bot_faq (title, triggers, answer, enabled, draft)
SELECT
  'Permuta - aceptan usado' AS title,
  ARRAY[
    'permuta','parte de pago','toman mi auto','tomam usado','acepta mi auto',
    'cambio el mio','entrego mi auto','puedo entregar','tengo auto para entregar',
    'cambiar mi auto','tomar en cuenta mi auto','en cuenta el mio'
  ]::text[] AS triggers,
  $$Sí, tomamos usados en parte de pago. Evaluamos caso a caso.
Para cotizarlo necesito: modelo, año, kilómetros y si tiene GNC.
¿Me pasás esos datos?$$ AS answer,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_faq WHERE title = 'Permuta - aceptan usado');

-- FAQ: Precio con IVA / precio final
INSERT INTO bot_faq (title, triggers, answer, enabled, draft)
SELECT
  'Precio final / IVA' AS title,
  ARRAY[
    'precio con iva','precio sin iva','el precio es final','precio final',
    'tiene iva el precio','incluye iva','impuesto incluido','precio publico',
    'es el precio total','hay cargos extra'
  ]::text[] AS triggers,
  $$Los precios que te paso son los publicados al público. Si querés confirmar si hay algún cargo adicional según tu caso, te lo confirma el asesor directamente.
¿Querés que te pase el precio del auto que te interesa?$$ AS answer,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_faq WHERE title = 'Precio final / IVA');

-- FAQ: Visita a la agencia
INSERT INTO bot_faq (title, triggers, answer, enabled, draft)
SELECT
  'Visita - cómo ir a ver el auto' AS title,
  ARRAY[
    'puedo ir a ver','quiero ir a ver','como hago una visita','ir a la agencia',
    'puedo pasar','cuando puedo pasar','quiero pasar','me gustaria ir',
    'puedo verlo en persona','verlo en persona','ir a verlo','lo veo',
    'como coordino','coordinar visita'
  ]::text[] AS triggers,
  $$Por supuesto, podés venir a verlo cuando quieras.
Estamos en Tandil, Lun a Vie de 9 a 18 hs y los Sáb de 9:30 a 13 hs.
¿Qué día te queda mejor? Te aviso disponibilidad del auto y te esperamos.$$ AS answer,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_faq WHERE title = 'Visita - cómo ir a ver el auto');

-- FAQ: Reserva / apartar
INSERT INTO bot_faq (title, triggers, answer, enabled, draft)
SELECT
  'Reserva - cómo apartar un auto' AS title,
  ARRAY[
    'reserva','reservar','apartar','se puede apartar','puedo reservar',
    'como reservo','para reservar','seña','señar','dejar seña',
    'como aparto','lo aparto','quiero apartarlo','me lo guardas'
  ]::text[] AS triggers,
  $$Sí, se puede reservar con una seña. El monto lo coordina el asesor según el caso.
¿Querés que te ponga en contacto con alguien para arreglarlo hoy?$$ AS answer,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_faq WHERE title = 'Reserva - cómo apartar un auto');

-- FAQ: Garantía
INSERT INTO bot_faq (title, triggers, answer, enabled, draft)
SELECT
  'Garantía del vehículo' AS title,
  ARRAY[
    'garantia','tiene garantia','que garantia','garantia incluida','incluye garantia',
    'garantia del auto','cuanta garantia','por cuanto tiempo garantia',
    'si se rompe','si falla','garantizado'
  ]::text[] AS triggers,
  $$Depende del auto y si es 0km o usado.
Los 0km tienen la garantía del fabricante. Los usados se analizan caso a caso.
¿Cuál te interesa? Te confirmo las condiciones específicas.$$ AS answer,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_faq WHERE title = 'Garantía del vehículo');

-- FAQ: GNC / gas
INSERT INTO bot_faq (title, triggers, answer, enabled, draft)
SELECT
  'GNC - vehículos con gas' AS title,
  ARRAY[
    'gnc','gas natural','viene con gas','tiene gnc','con gnc','trae gnc',
    'gnc de fabrica','gnc instalado','equipo de gas','gas comprimido',
    'tiene gas','viene con gnc','quiero con gnc'
  ]::text[] AS triggers,
  $$Algunos de nuestros usados ya vienen con GNC instalado.
Decime qué modelo buscás o cuál es tu presupuesto y te filtro los que tienen GNC disponible.$$ AS answer,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_faq WHERE title = 'GNC - vehículos con gas');

-- FAQ: Test drive
INSERT INTO bot_faq (title, triggers, answer, enabled, draft)
SELECT
  'Test drive' AS title,
  ARRAY[
    'test drive','prueba de manejo','manejar antes','puedo probarlo',
    'probar el auto','dar una vuelta','vuelta de prueba','manejar para ver',
    'puedo manejarlo','lo puedo probar'
  ]::text[] AS triggers,
  $$Sí, hacemos test drive. Coordinás la visita y podés probarlo antes de decidir.
¿Qué auto te interesa y qué día podrías venir? Te aviso disponibilidad.$$ AS answer,
  true, false
WHERE NOT EXISTS (SELECT 1 FROM bot_faq WHERE title = 'Test drive');

-- ============================================================
-- PLAYBOOKS — flujos por intención comercial
-- ============================================================

-- Playbook: COMPRA_DIRECTA — "quiero ese", "lo tomo", "cómo lo compro"
INSERT INTO bot_playbooks (intent, triggers, template, enabled, draft, config)
SELECT
  'compra_directa' AS intent,
  ARRAY[
    'lo tomo','lo quiero','quiero ese','me lo llevo','lo compro',
    'como lo compro','lo reservo','quiero comprar','lo agarro',
    'hacemos algo','cuanto pago para llevarlo','como arrancamos'
  ]::text[] AS triggers,
  $$Genial, avancemos. Para cerrar necesito confirmarte unos datos rápido:
- ¿Es el {{model}} {{year}} que vimos?
- ¿Vas a pagar en efectivo o querés financiar parte?
- ¿Tenés un usado para entregar?

Con eso te pongo en contacto con el asesor para coordinar la seña y el trámite. ¿Dale?$$ AS template,
  true, false,
  jsonb_build_object(
    'action', 'ESCALATE_HUMAN',
    'handoffRecommended', true,
    'required_fields', jsonb_build_array('payment_type'),
    'autoAskMissing', true,
    'lead_temp', 'caliente'
  )
WHERE NOT EXISTS (SELECT 1 FROM bot_playbooks WHERE intent = 'compra_directa');

-- Playbook: COMPARACION — "¿cuál es mejor?", "diferencia entre X e Y"
INSERT INTO bot_playbooks (intent, triggers, template, enabled, draft, config)
SELECT
  'comparacion' AS intent,
  ARRAY[
    'cual es mejor','diferencia entre','comparo','me conviene mas',
    'cual me recomendas','entre los dos','cual elijo','que diferencia tiene',
    'mejor opcion','cual te parece','me conviene'
  ]::text[] AS triggers,
  $$Buena pregunta. Depende de qué priorizás:
- Si buscás comodidad y equipamiento: {{option_a}} tiene ventaja por {{reason_a}}.
- Si priorizás precio y economía: {{option_b}} puede ser mejor por {{reason_b}}.

¿Qué es lo más importante para vos: cuota, rendimiento, espacio o algo específico? Con eso te recomiendo uno.$$ AS template,
  true, false,
  jsonb_build_object(
    'required_fields', jsonb_build_array('priority'),
    'autoAskMissing', true,
    'lead_temp', 'tibio'
  )
WHERE NOT EXISTS (SELECT 1 FROM bot_playbooks WHERE intent = 'comparacion');

-- Playbook: INDECISION — "no sé qué elegir", "qué me recomendás"
INSERT INTO bot_playbooks (intent, triggers, template, enabled, draft, config)
SELECT
  'indecision' AS intent,
  ARRAY[
    'no se que elegir','que me recomendes','que me recomendas','no se cual tomar',
    'ayudame a elegir','cual me conviene','no me decido','me ayudas a elegir',
    'que auto me compro','que auto me recomendes','que opcion es mejor',
    'cual comprarias','cual tomarias vos'
  ]::text[] AS triggers,
  $$Dale, te ayudo. Para recomendarte bien necesito saber:
1) ¿Para qué vas a usar el auto (ciudad, ruta, familia, trabajo)?
2) ¿Cuál es tu presupuesto máximo?
3) ¿Tiene que ser automático o te da igual la caja?

Con eso te paso 2 opciones concretas que se ajusten a tu caso.$$ AS template,
  true, false,
  jsonb_build_object(
    'required_fields', jsonb_build_array('use_case','budget','transmission'),
    'autoAskMissing', true,
    'lead_temp', 'tibio'
  )
WHERE NOT EXISTS (SELECT 1 FROM bot_playbooks WHERE intent = 'indecision');

-- Playbook: VISITA — "¿puedo ir a ver?", "¿dónde están?"
INSERT INTO bot_playbooks (intent, triggers, template, enabled, draft, config)
SELECT
  'visita' AS intent,
  ARRAY[
    'puedo ir a ver','quiero ir a ver','cuando puedo pasar','quiero pasar',
    'puedo ir hoy','ir a la agencia','visita','coordinar visita',
    'me gustaria verlo','podria ir','cuando abren para ir',
    'quiero verlo en persona','ir a verlos'
  ]::text[] AS triggers,
  $$¡Dale! Te esperamos.
Estamos en Tandil, Lun a Vie 9 a 18 hs · Sáb 9:30 a 13 hs.

¿Qué auto te interesa ver? Así te confirmo que está disponible para cuando vengas.$$ AS template,
  true, false,
  jsonb_build_object(
    'action', 'SCHEDULE_VISIT',
    'required_fields', jsonb_build_array('vehicle_id','visit_day'),
    'autoAskMissing', true,
    'lead_temp', 'caliente'
  )
WHERE NOT EXISTS (SELECT 1 FROM bot_playbooks WHERE intent = 'visita');

-- Playbook: CIERRE_FRIO — "voy a pensarlo", "después te aviso"
INSERT INTO bot_playbooks (intent, triggers, template, enabled, draft, config)
SELECT
  'cierre_frio' AS intent,
  ARRAY[
    'voy a pensarlo','lo pienso','despues te aviso','ya te aviso',
    'no me convence','no se','tengo que pensarlo','lo consulto',
    'lo hablo','lo veo','no estoy seguro','no por ahora',
    'quizas despues','tal vez mas adelante','por ahora no'
  ]::text[] AS triggers,
  $$Perfecto, no hay apuro. Guardá este número por si querés consultar algo más.

Solo te digo: este auto suele rotar rápido y no siempre hay stock. Si en algún momento querés que lo reserve mientras decidís, avisame y lo vemos.

¿Hay algo que te frenó o alguna duda que pueda resolver ahora?$$ AS template,
  true, false,
  jsonb_build_object(
    'action', 'KEEP_WARM',
    'lead_temp', 'frio',
    'follow_up_recommended', true
  )
WHERE NOT EXISTS (SELECT 1 FROM bot_playbooks WHERE intent = 'cierre_frio');

-- ============================================================
-- EXAMPLES — casos reales con respuesta ideal
-- ============================================================

INSERT INTO bot_examples (intent, user_text, ideal_answer, notes)
SELECT
  'compra_directa',
  'me convence, lo tomo, qué hago?',
  $$Genial! Para avanzar necesito confirmar un par de cosas:
- ¿Es el mismo auto que venimos viendo?
- ¿Vas a pagar todo en efectivo o querés ver financiación?
- ¿Tenés un auto para entregar?

Te pongo en contacto con el asesor ahora mismo para coordinar la seña. ¿Dale?$$,
  'Detectar COMPRA_DIRECTA → confirmar datos → escalar a humano. No inventar precio ni condiciones.'
WHERE NOT EXISTS (SELECT 1 FROM bot_examples WHERE intent = 'compra_directa' AND user_text = 'me convence, lo tomo, qué hago?');

INSERT INTO bot_examples (intent, user_text, ideal_answer, notes)
SELECT
  'indecision',
  'no sé qué elegir, qué me recomendás?',
  $$Para ayudarte bien necesito saber tres cosas:
1) ¿Para qué lo vas a usar más (ciudad, ruta, familia)?
2) ¿Qué presupuesto máximo manejás?
3) ¿Necesitás que sea automático?

Con eso te paso 2 opciones concretas que encajen con tu caso.$$,
  'No dar lista genérica. Primero filtrar con 3 preguntas clave antes de recomendar.'
WHERE NOT EXISTS (SELECT 1 FROM bot_examples WHERE intent = 'indecision' AND user_text = 'no sé qué elegir, qué me recomendás?');

INSERT INTO bot_examples (intent, user_text, ideal_answer, notes)
SELECT
  'comparacion',
  'cuál me conviene más, el Cronos o el Onix?',
  $$Depende de qué priorizás:
- El Cronos tiene más espacio interior y es más cómodo en ruta.
- El Onix suele ser más liviano en mantenimiento y fácil de estacionar en ciudad.

¿Qué usás más, ciudad o ruta? ¿Y tenés presupuesto definido? Así te tiro la recomendación directa.$$,
  'Comparar con criterio real, no listar specs técnicos. Pregunta de cierre orientada a decidir.'
WHERE NOT EXISTS (SELECT 1 FROM bot_examples WHERE intent = 'comparacion' AND user_text = 'cuál me conviene más, el Cronos o el Onix?');

INSERT INTO bot_examples (intent, user_text, ideal_answer, notes)
SELECT
  'cierre_frio',
  'voy a pensarlo, después te aviso',
  $$Perfecto, tomá el tiempo que necesitás.
Solo te cuento que este modelo rota bastante seguido y no siempre hay stock.
Si en algún momento querés que lo aparte mientras decidís, avisame.
¿Hay algo que todavía no te convence o alguna duda que pueda sacarte ahora?$$,
  'No presionar. Dejar la puerta abierta. Generar leve urgencia sin ser agresivo. Terminar con pregunta de apertura.'
WHERE NOT EXISTS (SELECT 1 FROM bot_examples WHERE intent = 'cierre_frio' AND user_text = 'voy a pensarlo, después te aviso');

INSERT INTO bot_examples (intent, user_text, ideal_answer, notes)
SELECT
  'visita',
  'puedo ir a ver el auto hoy?',
  $$¡Dale! Te esperamos hoy.
Estamos en Tandil, hasta las 18 hs.
¿A partir de qué hora más o menos venís? Así te confirmo que el auto está disponible y avisamos al asesor.$$,
  'Respuesta rápida y acogedora. Confirmar disponibilidad del auto. Pedir hora aproximada para avisar al asesor.'
WHERE NOT EXISTS (SELECT 1 FROM bot_examples WHERE intent = 'visita' AND user_text = 'puedo ir a ver el auto hoy?');

INSERT INTO bot_examples (intent, user_text, ideal_answer, notes)
SELECT
  'financiacion',
  'cuánto sería la cuota del Cronos?',
  $$La cuota depende del anticipo y los meses. Por ejemplo:
- Con un anticipo de $5M y 24 cuotas, la cuota estimada ronda los $X.
- Con más anticipo, la cuota baja bastante.

¿Cuánto podrías poner de anticipo y en cuántos meses lo querés pagar? Con eso te paso el número exacto.$$,
  'No inventar cuota exacta. Dar ejemplo de rango para orientar. Preguntar anticipo y plazo concretos.'
WHERE NOT EXISTS (SELECT 1 FROM bot_examples WHERE intent = 'financiacion' AND user_text = 'cuánto sería la cuota del Cronos?');

INSERT INTO bot_examples (intent, user_text, ideal_answer, notes)
SELECT
  'permuta',
  'tengo un Corsa 2010 para entregar, ¿lo toman?',
  $$Sí, evaluamos usados en parte de pago.
Para el Corsa 2010 necesito saber: ¿cuántos kilómetros tiene y tiene GNC?
Con eso te digo si lo podemos tomar y en cuánto lo valuamos.$$,
  'Pedir km y GNC directamente. No comprometerse con valor sin datos. No rechazar de entrada aunque suene viejo.'
WHERE NOT EXISTS (SELECT 1 FROM bot_examples WHERE intent = 'permuta' AND user_text = 'tengo un Corsa 2010 para entregar, ¿lo toman?');

-- ============================================================
-- TEST CASES — nuevos casos para suite de evaluación
-- ============================================================

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'compra_01_lo_tomo',
  'dale me lo llevo, qué hago?',
  'compra_directa',
  'playbook',
  ARRAY['seña','asesor','efectivo'],
  ARRAY['precio es X','te lo mando'],
  ARRAY['payment_type'],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'compra_01_lo_tomo');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'compra_02_como_reservo',
  'cómo hago para reservarlo?',
  'compra_directa',
  'faq',
  ARRAY['seña','asesor'],
  ARRAY['gratis','sin cargo'],
  ARRAY[]::text[],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'compra_02_como_reservo');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'indecision_01_que_me_recomendas',
  'no sé qué elegir, qué me recomendás?',
  'indecision',
  'playbook',
  ARRAY['uso','presupuesto','automático'],
  ARRAY['tengo este'],
  ARRAY['use_case','budget'],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'indecision_01_que_me_recomendas');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'indecision_02_ayudame',
  'ayudame a elegir, no me decido entre sedán y SUV',
  'indecision',
  'playbook',
  ARRAY['uso','presupuesto'],
  ARRAY['todos son buenos'],
  ARRAY['use_case'],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'indecision_02_ayudame');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'comparacion_01_cronos_onix',
  'cuál me conviene más, el Cronos o el Onix?',
  'comparacion',
  'playbook',
  ARRAY['ciudad','ruta','presupuesto'],
  ARRAY['ambos son iguales'],
  ARRAY['priority'],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'comparacion_01_cronos_onix');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'visita_01_puedo_ir_hoy',
  'puedo ir a ver el auto hoy?',
  'visita',
  'playbook',
  ARRAY['Tandil','18','disponible'],
  ARRAY['no se puede'],
  ARRAY['vehicle_id'],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'visita_01_puedo_ir_hoy');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'visita_02_cuando_abren',
  'cuándo puedo pasar a verlos?',
  'visita',
  'faq',
  ARRAY['Lun','Sáb','horario'],
  ARRAY['24hs'],
  ARRAY[]::text[],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'visita_02_cuando_abren');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'cierre_frio_01_lo_pienso',
  'lo pienso y te aviso',
  'cierre_frio',
  'playbook',
  ARRAY['aparte','stock','duda'],
  ARRAY['te llamo mañana a las 9','insist'],
  ARRAY[]::text[],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'cierre_frio_01_lo_pienso');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'cierre_frio_02_no_me_convence',
  'no me termina de convencer',
  'cierre_frio',
  'playbook',
  ARRAY['duda','convence','frena'],
  ARRAY['está bien'],
  ARRAY[]::text[],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'cierre_frio_02_no_me_convence');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'gnc_01_quiero_con_gas',
  'busco un auto con GNC',
  null,
  'faq',
  ARRAY['GNC','filtro','presupuesto'],
  ARRAY['no tenemos'],
  ARRAY[]::text[],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'gnc_01_quiero_con_gas');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'garantia_01_consulta',
  'tiene garantía?',
  null,
  'faq',
  ARRAY['0km','usado','fabricante'],
  ARRAY['2 años garantizados'],
  ARRAY[]::text[],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'garantia_01_consulta');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'testdrive_01_puedo_probar',
  'puedo probarlo antes de comprarlo?',
  null,
  'faq',
  ARRAY['test drive','coordinar','disponible'],
  ARRAY['no hacemos'],
  ARRAY[]::text[],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'testdrive_01_puedo_probar');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'iva_01_precio_final',
  'el precio que me pasaste es con IVA?',
  null,
  'policy',
  ARRAY['publicado','asesor','confirma'],
  ARRAY['sí, incluye todo','no tiene IVA'],
  ARRAY[]::text[],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'iva_01_precio_final');

INSERT INTO bot_test_cases (name, user_text, expected_intent, expected_source_type, expected_contains, expected_not_contains, expected_must_ask_fields, enabled)
SELECT
  'permuta_01_tengo_para_entregar',
  'tengo un auto para entregar como parte de pago',
  'usado',
  'playbook',
  ARRAY['modelo','año','kilómetros'],
  ARRAY['lo tomo seguro','sin ver'],
  ARRAY['tradein_model','tradein_year','tradein_km'],
  true
WHERE NOT EXISTS (SELECT 1 FROM bot_test_cases WHERE name = 'permuta_01_tengo_para_entregar');
