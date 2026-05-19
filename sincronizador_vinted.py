import json
import sys
from vinted_scraper import VintedScraper

ID_PERFIL_VINTED = "40700203"

def raspar_perfil():
    scraper = VintedScraper("https://www.vinted.es")
    try:
        prendas_vinted = scraper.search({"user_id": ID_PERFIL_VINTED})
        
        # Parseamos los objetos del scraper a un diccionario estándar serializable
        resultado_json = []
        for item in prendas_vinted:
            resultado_json.append({
                "id": item.id,
                "title": item.title,
                "price": item.price,
                "url": item.url
            })
            
        # Imprimimos el JSON por salida estándar (consola) para que Node.js lo lea
        print(json.dumps(resultado_json))
        
    except Exception as e:
        # En caso de error devolvemos una lista vacía para evitar romper el JSON del buffer
        print(json.dumps([]))

if __name__ == "__main__":
    raspar_perfil()