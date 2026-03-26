-- Migration 011: FAQs mejoradas para agencia de autos
-- Mejora cobertura de lenguaje informal argentino, agrega nuevos temas
-- y acorta respuestas para que sean más comerciales y accionables.

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

update bot_faq set
  triggers = array[
    'ubicacion','direccion','donde','donde queda','donde estan',
    'mapa','como llego','cómo llego','llegar','barrio','zona',
    'local','sucursal','agencia donde'
  ],
  answer = $$Estamos en Tandil, Buenos Aires.
Dame un minuto y te mando la ubicación exacta por WhatsApp para que llegues sin vueltas. 📍$$
where title = 'Ubicación';

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
