(function ($) {
  Drupal.behaviors.searchInput = {
    attach: function (context) {
    let basepath = Drupal.settings.basePath ?? '/';
    let url = window.location.href;

    if ( !url.includes('tramites_y_servicios') || jQuery("h3:contains('No se encontraron resultados')").length > 0 ) {
      if($("#block-system-main").find('div.search').length) {
        $("#block-system-main").find('form').hide();
      }

      $('#block-system-main form.search-form.main-form').hide();
    } 

    if ( url.includes('tramites_y_servicios') || url.includes('tramitar')) {
      $("#block-system-main").find('form').find('#edit-keys').attr('placeholder', 'Encontrá todos los trámites y servicios nacionales.');
      $("#block-system-main").find('form').attr('action', basepath + 'tramitar/tramites_y_servicios');
    } 

    $('.navbar-nav').find('form').each(function() {
          jQuery(this).attr('action', basepath + 'buscar');
    });

	//evita que determinados caracteres pasen del textbox
	$('#apachesolrsearchcustomform').submit(function(e){
		for( i=0; i < charDisabled.length ; i++ ){
			e.target[1].value = e.target[1].value.replace(new RegExp(/[<>\/\?¿\*%;]+/), '');
		}
    });

	//BUSCAR
	$('#search-form #edit-keys').keypress( function(e) {
    	if ($.inArray(e.key, charDisabled) >= 0) {
    		return false;
    	}
    });

},
    detach: function (context) {}
  };
}(jQuery));

