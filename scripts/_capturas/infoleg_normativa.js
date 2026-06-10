(function ($) {
  Drupal.behaviors.infolegNormativaSearch = {
    attach: function (context, settings) {
      var $form = $('.infoleg-search-form', context);
      if (!$form.length) {
        return;
      }

      var $tipo = $form.find('select[name="tipo_norma"]');
      var $anio = $form.find('select[name="anio"]');
      var leyRoute = (settings.infoleg_normativa && settings.infoleg_normativa.ley_route) ? settings.infoleg_normativa.ley_route : null;

      function updateAnioState() {
        if (leyRoute && $tipo.val() === leyRoute) {
          $anio.val('').prop('disabled', true);
        }
        else {
          $anio.prop('disabled', false);
        }
      }

      $tipo.on('change', function () {
        updateAnioState();
      });

      // Run on load
      updateAnioState();
    }
  };

  // Agregamos este nuevo bloque para inicializar el calendario limpio
  Drupal.behaviors.infolegDatepickerLimpio = {
    attach: function (context, settings) {
      // Buscamos los campos con nuestra clase y les armamos el datepicker
     $('.js-infoleg-datepicker', context).once('infoleg-date').datepicker({
        dateFormat: 'dd-mm-yy', // ¡Acá está la magia para que se vea 16-04-2026!
        changeMonth: true,
        changeYear: true,
        yearRange: "1853:+0"
      });
    }
  };

  Drupal.behaviors.panelMenu = {
    attach: function (context) {
      const panelMenu = () => {
        // Usamos 'context' en lugar de 'document' para optimizar peticiones AJAX
        const details = (context || document).querySelectorAll(".device-panel-menu");
        
        if (window.innerWidth >= 991) {
          details.forEach((e) => e.setAttribute("open", true));
        } else if (window.innerWidth < 991) {
          details.forEach((e) => e.removeAttribute("open"));
        }
      };

      // Reemplaza al DOMContentLoaded (Drupal lo ejecuta al cargar la página y en llamadas AJAX)
      panelMenu();

      // Solo vinculamos el evento 'resize' en la carga inicial de la página
      if (context === document) {
        window.addEventListener('resize', panelMenu, true);
      }
    }
  };

  Drupal.behaviors.infolegJurisdiccionRedirect = {
    attach: function (context, settings) {
      $('.js-jurisdiccion-select', context).once('jurisdiccion-redirect').change(function() {
        var valor = $(this).val();
        // Va exactamente a la ruta requerida sin importar la carpeta local
        window.location.href = '/normativa?jurisdiccion=' + valor;
      });
    }
  };


})(jQuery);



