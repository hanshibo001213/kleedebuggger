// 判断是否可以使用优惠券
int can_use_coupon(int purchase_amount, int has_membership) {
  int discount = 0;
  if (purchase_amount > 100) {  // 金额大于100
    if (has_membership) {  // 会员优惠
      discount = 20;
    } else {  // 非会员优惠
      discount = 10;
    }
  } else if (purchase_amount > 50) {  // 金额 50~100
    if (has_membership) {
      discount = 15;
    } else {
      discount = 5;
    }
  } else {  // 金额 0~50
    discount = 0;  // 无优惠
  }
  return discount;
}
int main() {
  int pur_amt;
  int has_mem;  // 1 表示有会员卡，0 表示无会员卡
  klee_make_symbolic(&pur_amt, sizeof(pur_amt), "pA");
  klee_make_symbolic(&has_mem, sizeof(has_mem), "hasM");
  int discount = can_use_coupon(pur_amt, has_mem);
  printf("Discount Applied: %d\n", discount);
  return 0;
}
