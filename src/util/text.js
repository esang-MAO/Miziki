export function normKey(s){
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g,'')
    .replace(/[^a-z0-9]+/g,' ').trim();
}
