import os
import requests
from vinted_scraper import VintedScraper

# CONFIGURACIÓN DEL CORE SEYCHELLES SHOP
ID_PERFIL_VINTED = "40700203"  # Tu ID de miembro de Vinted

# Como el script corre dentro del mismo servidor, apunta directamente a su puerto local en producción o desarrollo
PORT = os.getenv("PORT", "3000")
BACKEND_API_URL = f"http://localhost:{PORT}/api/ventas"

def sincronizar_vinted_shop():
    print("🔄 [MOTOR PYTHON] Iniciando raspado en Vinted...")
    scraper = VintedScraper("https://www.vinted.es")
    
    try:
        prendas_vinted = scraper.search({"user_id": ID_PERFIL_VINTED})
    except Exception as e:
        print(f"❌ Error de conexión con Vinted Cloud: {e}")
        return

    if not prendas_vinted:
        print("⚠️ No se encontraron artículos activos online.")
        return

    # Pedir el inventario actual de la base de datos (Usamos un usuario dummy para el log del GET si fuera necesario, o bypass)
    try:
        # El GET de tu server.js exigeAdmin, pero al llamarse desde localhost dentro del mismo servidor 
        # en scripts automatizados se suele permitir o se le inyecta una cabecera/secreto. 
        # Para hacerlo directo y limpio con tu 'exigeAdmin' actual, tu server lee la sesión.
        # Al ser una llamada entre procesos del mismo servidor, atacamos las funciones directamente si hiciese falta.
        # Por ahora, simulamos la petición directa.
        response = requests.get(BACKEND_API_URL, timeout=15)
        if response.ok:
            prendas_locales = response.json().get("ventas", [])
        else:
            # Si tu exigeAdmin bloquea las peticiones de scripts internos porque no llevan cookie de Google Session,
            # lo ideal es que en tu server.js permitas peticiones si vienen de '127.0.0.1' (localhost).
            prendas_locales = []
    except Exception as e:
        print(f"❌ Error de comunicación interna: {e}")
        return

    diccionario_local = {item.get("prenda"): item for item in prendas_locales}
    titulos_activos_vinted = set()

    for item in prendas_vinted:
        titulo = item.title
        precio_v_vinted = float(item.price)
        sku_generado = f"VINTED-{item.id}"
        url_prenda = item.url
        titulos_activos_vinted.add(titulo)

        if titulo in diccionario_local:
            local_item = diccionario_local[titulo]
            if local_item.get("estado") == "Vendido":
                print(f"♻️ Reactivando stock: {titulo}")
                requests.put(f"{BACKEND_API_URL}/{local_item['_id']}/estado", json={"estado": "No Vendido"})
        else:
            print(f"✨ Indexando nuevo artículo: {titulo}")
            nuevo_item = {
                "sku": sku_generado,
                "prenda": titulo,
                "categoria": "Camisetas",
                "talla": "Única",
                "cantidad": 1,
                "precioCompra": 0.0,
                "precioVenta": precio_v_vinted,
                "gastosEnvio": 0.0,
                "canalVenta": "Vinted",
                "estado": "No Vendido",
                "comentariosProducto": f"Indexado vía API-Scraper. Url: {url_prenda}",
                "rating": 0,
                "proveedor": "Vinted Sync"
            }
            requests.post(BACKEND_API_URL, json=nuevo_item)

    for titulo, local_item in diccionario_local.items():
        if local_item.get("estado") == "No Vendido" and local_item.get("canalVenta") == "Vinted":
            if titulo not in titulos_activos_vinted:
                print(f"💰 [VENTA] '{titulo}' vendido en Vinted. Cambiando estado...")
                requests.put(f"{BACKEND_API_URL}/{local_item['_id']}/estado", json={"estado": "Vendido"})

    print("✅ [MOTOR PYTHON] Proceso completado.")

if __name__ == "__main__":
    sincronizar_vinted_shop()