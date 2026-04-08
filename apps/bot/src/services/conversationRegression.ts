import assert from 'node:assert/strict';

import { buildNoStockReply, isConversationKeepAliveMessage, isSearchRefinementMessage, selectMentionedVehicle, wantsVehicleMedia } from './conversationRules.js';
import { extractLeadFields, shouldResetOperationalContext } from './extract.js';

function run(): void {
  assert.equal(shouldResetOperationalContext('hola'), false, 'un saludo puro no debe resetear contexto activo');
  assert.equal(shouldResetOperationalContext('ok'), false, 'un ok intermedio no debe resetear');
  assert.equal(shouldResetOperationalContext('busco otra cosa'), true, 'un cambio explícito sí debe resetear');

  const base = extractLeadFields('estoy buscando algo hasta 17 millones', {});
  const refinedYears = extractLeadFields('algun 2014 - 2017', base);
  assert.equal(refinedYears.maxPrice, 17_000_000, 'el presupuesto previo debe persistir en un follow-up');
  assert.equal(refinedYears.minYear, 2014, 'debe capturar año mínimo');
  assert.equal(refinedYears.maxYear, 2017, 'debe capturar año máximo');

  assert.equal(isConversationKeepAliveMessage('Hola como estas?'), true, 'saludo corto en hilo activo debe tratarse como keepalive');
  assert.equal(isConversationKeepAliveMessage('dale'), true, 'dale debe tratarse como keepalive');
  assert.equal(isSearchRefinementMessage('algo con pocos kilometros?'), true, 'pocos km debe ser refinamiento');
  assert.equal(isSearchRefinementMessage('mas nuevo automatico'), true, 'más nuevo/automático debe ser refinamiento');

  const vehicles = [
    { name: 'Volkswagen Vento 2.5 Luxury', brand: 'Volkswagen', model: 'Vento' },
    { name: 'Toyota Corolla XEI', brand: 'Toyota', model: 'Corolla' },
  ];
  assert.equal(
    selectMentionedVehicle('el vento me das mas detalles?', vehicles)?.model,
    'Vento',
    'el pedido de detalles debe priorizar el último vehículo mencionado'
  );

  const noStock = buildNoStockReply({ vehicleLabel: 'Volkswagen Vento' });
  assert.match(noStock, /no tengo stock confirmado/i, 'si no hay stock debe hablar en modo seguro');
  assert.doesNotMatch(noStock, /\btenemos\b/i, 'no debe afirmar stock inexistente');

  assert.equal(wantsVehicleMedia('el vento me das mas detalles?'), false, 'detalle no implica mandar imagen');
  assert.equal(wantsVehicleMedia('me mandas una foto del vento?'), true, 'foto explícita sí habilita media');

  console.log('conversationRegression OK');
}

run();
