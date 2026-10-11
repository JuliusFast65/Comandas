import { catalog } from "./catalog.js";

// Demonstration recipes, indexed in the same order as the seed catalog.
const recipes = {
  entradas: [
    ["Pan, tomate, ajo y albahaca", "Pan tostado con tomate fresco y aceite de oliva"],
    ["Totopos, queso, frijoles y jalapeños", "Totopos gratinados; salsas aparte", "Guacamole y pico de gallo"],
    ["Tortilla de trigo y queso", "Dorada a la plancha y cortada en triángulos", "Pico de gallo"],
    ["Calamar, harina y limón", "Aros rebozados y fritos", "Salsa tártara"],
    ["Alitas de pollo y salsa BBQ", "Horneadas y bañadas en salsa", "Bastones de apio"],
    ["Tortillas de maíz, res, cebolla y cilantro", "Carne salteada en tortillas calientes", "Limón y salsa"],
    ["Pescado, limón, cebolla y cilantro", "Pescado marinado en limón, servido frío", "Chifles"],
    ["Masa de trigo, carne y cebolla", "Rellenas y horneadas", "Salsa de la casa"],
    ["Garbanzos, tahini, limón y ajo", "Crema de garbanzos con aceite de oliva", "Pan pita"],
    ["Mozzarella, huevo y pan rallado", "Bastones empanizados y fritos", "Salsa de tomate"],
    ["Masa, papa, arvejas y especias", "Triángulos rellenos y fritos", "Salsa de yogur"],
    ["Masa fina, repollo, zanahoria y brotes", "Rollos de vegetales fritos", "Salsa agridulce"],
    ["Masa, cerdo, repollo y jengibre", "Cocidos al vapor y dorados en la base", "Salsa de soya"],
    ["Aguacate, tomate, cebolla y limón", "Aguacate majado con vegetales frescos", "Totopos"],
    ["Res, rúcula, parmesano y limón", "Láminas finas de res cruda con aderezo de limón"],
  ],
  platos: [
    ["Masa, tomate, mozzarella y albahaca", "Horneada hasta dorar la masa"],
    ["Pasta de trigo, tomate, ajo y parmesano", "Pasta al dente con salsa de tomate"],
    ["Pan, carne de res, queso, lechuga y tomate", "Carne a la plancha y pan tostado", "Papas fritas"],
    ["Lechuga, tomate, pepino y zanahoria", "Vegetales frescos con vinagreta aparte"],
    ["Arroz, alga nori, salmón y pepino", "Rollos fríos cortados en ocho piezas", "Soya, jengibre y wasabi"],
    ["Tortilla de trigo, res, arroz y frijoles", "Relleno caliente, enrollado y dorado", "Pico de gallo"],
    ["Arroz, camarón, calamar, pimiento y azafrán", "Arroz cocido en caldo con mariscos"],
    ["Arroz arborio, champiñones, caldo y parmesano", "Cocción lenta, acabado cremoso"],
    ["Pollo, ajo, romero y limón", "Pollo marinado y asado al horno", "Arroz y ensalada"],
    ["Carne de res, sal y pimienta", "Sellado a la plancha al término solicitado", "Puré de papas y vegetales"],
    ["Pasta, carne de res, tomate, bechamel y queso", "Capas de pasta y relleno gratinadas al horno"],
    ["Pollo, pimiento, cebolla y tortillas", "Pollo y vegetales salteados", "Tortillas y guacamole"],
    ["Costillas de cerdo y salsa BBQ", "Cocción lenta y acabado glaseado", "Papas fritas y ensalada"],
    ["Pan pita, pollo, tomate y salsa de yogur", "Pollo especiado asado y envuelto en pita"],
    ["Pescado blanco, harina y papa", "Pescado rebozado y frito", "Papas fritas y salsa tártara"],
  ],
  postres: [
    ["Queso crema, galleta, huevo y azúcar", "Horneada y servida fría", "Salsa de frutos rojos"],
    ["Chocolate, mantequilla, huevo y harina", "Horneado con centro húmedo"],
    ["Leche, crema, azúcar y vainilla", "Servido en dos bolas"],
    ["Piña, sandía y melón", "Fruta fresca cortada al momento"],
    ["Bizcochos, café, mascarpone y cacao", "Capas de bizcocho y crema, servido frío"],
    ["Crema, yema, azúcar y vainilla", "Crema horneada con cubierta caramelizada"],
    ["Crema, azúcar, vainilla y gelatina", "Cuajada en frío", "Salsa de frutos rojos"],
    ["Zanahoria, harina, huevo y canela", "Bizcocho horneado", "Cobertura de queso crema"],
    ["Chocolate, crema y huevo", "Crema aireada y refrigerada"],
    ["Gelatina de fresa, agua y azúcar", "Cuajada y servida fría"],
    ["Leche, huevo, azúcar y vainilla", "Cocido a baño María con caramelo"],
    ["Masa choux, crema y chocolate", "Bocados horneados y rellenos de crema"],
    ["Bizcocho, crema, fresas y gelatina", "Capas de bizcocho, fruta y crema"],
    ["Manzana, masa, azúcar y canela", "Horneada con relleno de manzana"],
    ["Limón, leche condensada, huevo y galleta", "Base crujiente con crema de limón", "Merengue"],
  ],
  adicionales: [
    ["Papa, aceite y sal", "Bastones fritos"],
    ["Arroz, agua y sal", "Arroz blanco cocido"],
    ["Lechuga, tomate y pepino", "Vegetales frescos con vinagreta"],
    ["Aguacate, cebolla y limón", "Aguacate majado"],
    ["Queso fresco", "Porción rallada o en láminas"],
    ["Maíz, agua y sal", "Tortillas calentadas a la plancha"],
    ["Frijoles, cebolla y ajo", "Cocidos a fuego lento"],
    ["Tomate, cebolla y cilantro", "Salsa fresca de la casa"],
    ["Harina de trigo, agua y levadura", "Pan horneado y servido tibio"],
    ["Aguacate", "Porción en láminas"],
    ["Tocino de cerdo", "Dorado a la plancha"],
    ["Champiñones, ajo y mantequilla", "Salteados"],
    ["Cebolla, harina y huevo", "Aros rebozados y fritos"],
    ["Papa, leche y mantequilla", "Puré suave servido caliente"],
    ["Maíz y mantequilla", "Granos cocidos y salteados"],
  ],
};

export function exampleProductHelp(product) {
  const index = catalog[product.category]?.indexOf(product.name) ?? -1;
  const recipe = recipes[product.category]?.[index];
  if (!recipe) return null;
  const [ingredients, preparation, sides = ""] = recipe;
  return { ingredients, preparation, sides };
}
