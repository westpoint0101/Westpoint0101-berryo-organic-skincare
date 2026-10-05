(function () {
  "use strict";

  var catalogVersion = "2026-10-04-v2";
  var products = [
    ["dark-knuckle-cream-100ml", "Dark Knuckle Cream", "Body Care", "100ml", 20000, "dark-knuckle-cream.png"],
    ["snow-white-black-soap-250g", "Snow White Black Soap", "Soaps", "250g", 12000, "snow-white-black-soap.png"],
    ["snow-white-black-soap-500g", "Snow White Black Soap", "Soaps", "500g", 24000, "snow-white-black-soap.png"],
    ["snow-white-black-soap-1kg", "Snow White Black Soap", "Soaps", "1kg", 50000, "snow-white-black-soap.png"],
    ["snow-white-black-soap-5kg", "Snow White Black Soap", "Soaps", "5kg", 160000, "snow-white-black-soap.png"],
    ["molato-whitening-soap-250g", "Molato Whitening Soap", "Soaps", "250g", 12000, "molato-whitening-face-body-soap.png"],
    ["molato-whitening-soap-500g", "Molato Whitening Soap", "Soaps", "500g", 25000, "molato-whitening-face-body-soap.png"],
    ["molato-whitening-soap-1kg", "Molato Whitening Soap", "Soaps", "1kg", 50000, "molato-whitening-face-body-soap.png"],
    ["molato-whitening-soap-5kg", "Molato Whitening Soap", "Soaps", "5kg", 160000, "molato-whitening-face-body-soap.png"],
    ["snow-white-shower-gel-500ml", "Snow White Shower Gel", "Body Care", "500ml", 12000, "snow-white-shower-gel.png"],
    ["snow-white-shower-gel-1l", "Snow White Shower Gel", "Body Care", "1 litre", 25000, "snow-white-shower-gel.png"],
    ["snow-white-luxury-cream-300ml", "Snow White Luxury Cream", "Body Care", "300ml", 30000, "snow-white-luxury-cream.png"],
    ["snow-white-luxury-cream-500ml", "Snow White Luxury Cream", "Body Care", "500ml", 60000, "snow-white-luxury-cream.png"],
    ["snow-white-luxury-cream-1l", "Snow White Luxury Cream", "Body Care", "1 litre", 120000, "snow-white-luxury-cream.png"],
    ["half-cast-cream-300ml", "Half Cast Cream", "Body Care", "300ml", 30000, "whitening-face-skin.png"],
    ["half-cast-cream-500ml", "Half Cast Cream", "Body Care", "500ml", 60000, "whitening-face-skin.png"],
    ["half-cast-cream-1l", "Half Cast Cream", "Body Care", "1 litre", 120000, "whitening-face-skin.png"],
    ["face-cleanser-120ml", "Face Cleanser", "Face Care", "120ml", 8000, "face-cleanser.png"],
    ["whitening-glowing-oil-100ml", "Whitening & Glowing Oil", "Body Care", "100ml", 12000, "whitening-face-skin.png"],
    ["whitening-glowing-oil-200ml", "Whitening & Glowing Oil", "Body Care", "200ml", 25000, "whitening-face-skin.png"],
    ["whitening-glowing-oil-500ml", "Whitening & Glowing Oil", "Body Care", "500ml", 50000, "whitening-face-skin.png"],
    ["whitening-glowing-oil-1l", "Whitening & Glowing Oil", "Body Care", "1 litre", 150000, "whitening-face-skin.png"],
    ["face-cream-100g", "Face Cream", "Face Care", "100g", 20000, "face-creams-duo.png"],
    ["face-cream-150g", "Face Cream", "Face Care", "150g", 25000, "face-creams-duo.png"],
    ["pink-lips-10g", "Pink Lips", "Lip Care", "10g", 5000, "lip-balm.png"],
    ["pink-lips-20g", "Pink Lips", "Lip Care", "20g", 7000, "lip-balm.png"],
    ["turmeric-lightening-body-scrub-250g", "Turmeric Lightening Body Scrub", "Body Care", "250g", 12000, "turmeric-lightening-body-scrub.png"],
    ["turmeric-lightening-body-scrub-500g", "Turmeric Lightening Body Scrub", "Body Care", "500g", 24000, "turmeric-lightening-body-scrub.png"],
    ["turmeric-lightening-body-scrub-1l", "Turmeric Lightening Body Scrub", "Body Care", "1 litre", 50000, "turmeric-lightening-body-scrub.png"],
  ].map(function (item, index) {
    var name = item[1];
    return {
      id: item[0],
      name: name + " (" + item[3] + ")",
      category: item[2],
      size: item[3],
      price: item[4],
      image: "./assets/products/" + item[5],
      rating: 5,
      reviews: 0,
      stock: "In Stock",
      sku: "BO-" + String(index + 1).padStart(3, "0"),
      featured: index < 5,
      description: name + " from BERRYO Organic Skincare.",
      benefits: [item[2], "Daily skincare routine"],
      ingredients: "Ingredients are listed on the product packaging.",
    };
  });

  window.BERRYO_CATALOG = products;

  try {
    if (localStorage.getItem("berryo-catalog-version") !== catalogVersion) {
      localStorage.setItem("berryo-products", JSON.stringify(products));
      localStorage.setItem("berryo-catalog-version", catalogVersion);
    }
  } catch (error) {
    console.error("BERRYO catalog could not be initialized.", error);
  }
})();
