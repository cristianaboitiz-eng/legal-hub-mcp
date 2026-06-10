(function ($) {
  Drupal.behaviors.infolegJuridiccionToggle = {
    attach: function (context, settings) {
      
      // Función para cambiar la visibilidad
      function conmutarBloques(valor) {
        if (valor === 'provincial') {
          $('.infoleg-search-layout').hide();//bloque 1 =  nacional
	  // Buscamos el botón de submit dentro del formulario de bloque 1
          $('.infoleg-search-layout').find('input[type="submit"], button').prop('disabled', true);//botón de nacional
          $('.pane-argentinagobar-formularios-infoleg-consulta-avanzada').show();//bloque provincial
        } else {
          $('.pane-argentinagobar-formularios-infoleg-consulta-avanzada').hide();//bloque provincial
	  // Buscamos el botón de submit dentro del formulario  de bloque 2
	  $('.pane-argentinagobar-formularios-infoleg-consulta-avanzada').find('input[type="submit"], button').prop('disabled', true);
          $('.infoleg-search-layout').show();//bloque nacional
        }
        
        // Sincronizamos AMBOS selects para que tengan el mismo valor seleccionado
        $('.js-jurisdiccion-select, .jurisdiccion-selector').val(valor);
      }

      // Ejecutar al cargar la página
      // Tomamos el valor del bloque 1 para decidir qué mostrar
      var valorInicial = $('.js-jurisdiccion-select').val();
      conmutarBloques(valorInicial);

      // Evento para el Select del Bloque 1
      $('.js-jurisdiccion-select', context).once('logic-b1').change(function (e) {
        var val = $(this).val();
        conmutarBloques(val);
      });

      // Evento para el Select del Bloque 2
      $('.jurisdiccion-selector', context).once('logic-b2').change(function (e) {
        var val = $(this).val();
        conmutarBloques(val);
      });
      
    }
  };

  Drupal.behaviors.infolegBoletinJuridiccionToggle = {
    attach: function (context, settings) {
      // Función para cambiar la visibilidad
      function conmutarBloques(valor) {
        if (valor === 'provincial') {
          $('.pane-infoleg-buscador-boletin').hide();//bloque 1 =  nacional
	  // Buscamos el botón de submit dentro del formulario de bloque 1
          $('.pane-argentinagobar-formularios-infoleg-consulta-boletin').show();//bloque provincial
        } else {
          $('.pane-argentinagobar-formularios-infoleg-consulta-boletin').hide();//bloque provincial
	  // Buscamos el botón de submit dentro del formulario  de bloque 2
	        $('.pane-infoleg-buscador-boletin').show();//bloque nacional
        }
        
        // Sincronizamos AMBOS selects para que tengan el mismo valor seleccionado
        $('.js-jurisdiccion-select-boletin, .jurisdiccion-change-processed').val(valor);
      }

      // Ejecutar al cargar la página
      // Tomamos el valor del bloque 1 para decidir qué mostrar
      var valorInicial = $('.js-jurisdiccion-select-boletin').val();
      conmutarBloques(valorInicial);

      // Evento para el Select del Bloque 1
      $('.js-jurisdiccion-select-boletin', context).once('logic-b1').change(function (e) {
        var val = $(this).val();
        conmutarBloques(val);
      });

      // Evento para el Select del Bloque 2
      $('.jurisdiccion-change-processed', context).once('logic-b2').change(function (e) {
        var val = $(this).val();
        conmutarBloques(val);
      });
      
    }
  };
})(jQuery);
