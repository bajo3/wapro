-- Migration 011: FAQs mejoradas para agencia de autos
-- Mejora cobertura de lenguaje informal argentino, agrega nuevos temas
-- y acorta respuestas para que sean más comerciales y accionables.

-- ─── ACTUALIZAR FAQs EXISTENTES ──────────────────────────────────────────────

-- Horarios (más triggers coloquiales)
update bot_faq set
  triggers = array[
    'horario','horarios','abren','cierran','atienden',
    'abre','cierra','horas','cuando abren','cuando cierran',
    'sabado','domingo','finde','fin de semana','laboral'
  ],
  answer = $$Atendemos:
🗓 Lun a Vie: 9 a 18 hs
🗓 Sáb: 9:30 a 13 hs
¿Qué día te queda mejor para pasar?$$
where title = 'Horarios';

-- Ubicación (más triggers, CTA más directo)
update bot_faq set
  triggers = array[
    'ubicacion','direccion','donde','donde queda','donde estan',
    'mapa','como llego','cómo llego','llegar','barrio','zona',
    'local','sucursal','agencia donde'
  ],
  answer = $$Estamos en Tandil, Buenos Aires.
Dame un minuto y te mando la ubicación exacta por WhatsApp para que llegues sin vueltas. 📍$$
where title = 'Ubicación';

-- Requisitos financiación
update bot_faq set
  triggers = array[
    'requisitos','papeles','documentacion','documentos','dni',
    'recibo','sueldo','garante','aval','necesito','pido'
  ],
  answer = $$Con DNI podemos arrancar una pre-evaluación.
Para cotizarte algo concreto decime:
- ¿Qué auto te interesa?
- ¿Cuánto querés poner de anticipo?
- ¿En cuántas cuotas?$$
where title = 'Requisitos financiación (básico)';

-- ─── NUEVAS FAQs ──────────────────────────────────────────────────────────────

-- Precio / valor (cobertura amplia)
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Precio - consulta general' as title,
  array[
    'precio','precios','cuanto sale','cuanto cuesta','a cuanto',
    'valor','valores','cuanto esta','che cuanto','cuanto vale',
    'en efectivo','contado','precio lista','sale','cuesta'
  ]::text[] as triggers,
  $$Los precios dependen del modelo. Decime cuál te interesa y te paso la ficha con precio y forma de pago.
Si tenés un presupuesto en mente también te digo qué opciones tenés 👌$$ as answer,
  true, false
where not exists (select 1 from bot_faq where title = 'Precio - consulta general');

-- Stock / disponibilidad
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Stock - consulta general' as title,
  array[
    'tenes','hay','stock','disponible','tienen','tenes algo',
    'que autos tienen','que tienen','que hay','que modelos',
    'me mostrás','mostrame','opciones'
  ]::text[] as triggers,
  $$Decime qué buscás (marca, modelo, presupuesto) y te muestro lo que tenemos disponible ahora mismo.
Renovamos stock seguido, así que siempre hay opciones 🚗$$ as answer,
  true, false
where not exists (select 1 from bot_faq where title = 'Stock - consulta general');

-- Financiación general
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Financiación - info general' as title,
  array[
    'financiacion','financiar','cuotas','a cuotas','en cuotas',
    'prestamo','credito','pagar en cuotas','financio','financiado',
    'banco','plan','anticipo','enganche'
  ]::text[] as triggers,
  $$Sí, financiamos. Necesito saber:
- ¿Qué auto te interesa?
- ¿Cuánto de anticipo tenés?
- ¿En cuántas cuotas querés pagarlo?

Con eso te armo una estimación rápida 🤝$$ as answer,
  true, false
where not exists (select 1 from bot_faq where title = 'Financiación - info general');

-- Test drive
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Test drive' as title,
  array[
    'test drive','manejar','probar','prueba','probarlo',
    'probarte','manejo','me deja manejar','puedo probar',
    'dar una vuelta','salir a probar'
  ]::text[] as triggers,
  $$¡Obvio! Podés venir y manejarlo sin compromiso.
¿Qué modelo querés probar y qué día te viene bien? Te coordino la visita 🚗$$ as answer,
  true, false
where not exists (select 1 from bot_faq where title = 'Test drive');

-- Reserva / seña
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Reserva y seña' as title,
  array[
    'reservar','reserva','seña','señar','separar','apartarlo',
    'lo separo','quiero reservarlo','como reservo','reservarlo',
    'enganche','señar','pago señal'
  ]::text[] as triggers,
  $$Podés reservarlo con una seña. Te coordino los datos con un asesor para que lo tramiten rápido.
¿Cuál es el auto y tu nombre? 👍$$ as answer,
  true, false
where not exists (select 1 from bot_faq where title = 'Reserva y seña');

-- Garantía
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Garantía' as title,
  array[
    'garantia','garantía','garantizado','tiene garantia','cuanto de garantia',
    'si falla','si tiene problema','post venta','posventa'
  ]::text[] as triggers,
  $$Todos nuestros autos salen revisados. Según el vehículo podemos ofrecerte garantía.
Decime cuál te interesa y te confirmo qué garantía tiene ese en particular 🔧$$ as answer,
  true, false
where not exists (select 1 from bot_faq where title = 'Garantía');

-- 0km
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  '0km - info' as title,
  array[
    '0km','cero km','0 km','nuevo','autos nuevos','tiene 0km',
    'cero kilómetros','0 kilometros','cero'
  ]::text[] as triggers,
  $$Sí, trabajamos con 0km de varias marcas además de usados.
Decime qué marca y modelo te interesa y te paso las opciones disponibles con precio y equipamiento 🚀$$ as answer,
  true, false
where not exists (select 1 from bot_faq where title = '0km - info');

-- Documentación para transferencia
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Documentación - transferencia' as title,
  array[
    'documentacion','documentos','papeles','cedula','titulo',
    'transferencia','transferir','tramite','tramites','patente',
    'radicacion','inscripcion'
  ]::text[] as triggers,
  $$Nosotros te guiamos con todo el trámite de transferencia.
En general necesitás: DNI, título del vehículo y datos del comprador/vendedor.
¿Qué operación estás haciendo? Te acompaño paso a paso 📋$$ as answer,
  true, false
where not exists (select 1 from bot_faq where title = 'Documentación - transferencia');

-- Visita / coordinación
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Visita - coordinación' as title,
  array[
    'visita','visitar','ir a ver','pasar','paso','cuando puedo ir',
    'voy','me acerco','ir','quiero ver','vernos','acordamos'
  ]::text[] as triggers,
  $$¡Dale! Coordinamos.
¿Qué día y horario te viene bien? Así te confirmo disponibilidad y el auto que querés ver 📅$$ as answer,
  true, false
where not exists (select 1 from bot_faq where title = 'Visita - coordinación');

-- Mantenimiento / service
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Mantenimiento y service' as title,
  array[
    'service','mantenimiento','revision','mecánico','taller',
    'tiene service','tiene revision','mantenimiento al dia'
  ]::text[] as triggers,
  $$Podés pedirme el historial de service del auto que te interesa.
La mayoría de nuestros usados sale con revisión hecha. ¿Cuál auto tenés en mente? 🔩$$ as answer,
  true, false
where not exists (select 1 from bot_faq where title = 'Mantenimiento y service');

-- Permuta (update del playbook + FAQ combinada)
insert into bot_faq (title, triggers, answer, enabled, draft)
select
  'Permuta - cómo funciona' as title,
  array[
    'permuta','permutar','canjear','parte de pago','tomo mi auto',
    'entrego el mio','cambio mi auto','quiero canjearlo'
  ]::text[] as triggers,
  $$Sí, tomamos usados en parte de pago 🔄
Para evaluarlo necesito:
- Marca, modelo y año
- Kilómetros
- Estado general (y si tiene GNC)

Con eso te digo si lo podemos tomar y cuánto te aplicamos.$$ as answer,
  true, false
where not exists (select 1 from bot_faq where title = 'Permuta - cómo funciona');