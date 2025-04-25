#include <stdio.h>
#include <stdlib.h>
#include "klee.h"

#define MAX_USERS 8

int get_user_index(int user_ids[], int len, int target_id)
{
    int i;
    int found = 0;

    for (i = 0; i <= len; i++)
    {
        if (user_ids[i] == target_id)
        {
            found = 1;
            break;
        }
    }

    if (!found)
    {
        printf("User not found\n");
        return -1;
    }

    return i;
}

int main()
{
    int len;
    klee_make_symbolic(&len, sizeof(len), "len");
    klee_assume(len > 0 && len <= MAX_USERS);

    int user_ids[MAX_USERS];
    klee_make_symbolic(user_ids, sizeof(user_ids), "user_ids");

    int target_id;
    klee_make_symbolic(&target_id, sizeof(target_id), "target_id");

    int idx = get_user_index(user_ids, len, target_id);
    printf("User index: %d\n", idx);
    return 0;
}
